import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getDelegateAffiliationRoleId } from '../src/professionals/delegateRole';
import { createInvoice } from '../src/portal/createInvoice';
import { createTimeEntry } from '../src/portal/createTimeEntry';
import { deleteTimeEntry, TimeEntryNotFoundError, updateTimeEntry } from '../src/portal/changeTimeEntry';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';
import {
  billableProfessionalIds,
  delegateOfficeIds,
  representedProfessionalIds,
  resolvePortalActor,
  timeReadableProfessionalIds,
} from '../src/portal/portalActor';
import { recallInvoice } from '../src/billing/invoiceLifecycle';
import { canPortalReaderReadInvoice } from '../src/billing/invoiceAccess';
import { listPortalCases } from '../src/portal/listPortalCases';
import { giveRate } from './rateHelpers';
import { ValidationError } from '../src/errors';
import { caseAssignment, invoice, invoiceEvent, invoiceLine, person, personAffiliation, professional, timeEntry, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

const STARTED = new Date('2026-01-01T00:00:00Z');

async function createProfessional(email: string, inOffice: boolean) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  if (inOffice) {
    const [row] = await testDb.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, professionalId));
    await testDb.insert(personAffiliation).values({
      personId: row!.personId,
      organizationId: fixtures.organizationId,
      officeId: fixtures.officeId,
      startedAt: STARTED,
    });
  }
  return { userAccountId: account!.userAccountId, professionalId };
}

// An office support user with no professional profile; with a role, a delegate.
async function createOfficeUser(email: string, withDelegateRole: boolean) {
  const [personRow] = await testDb.insert(person).values({ displayName: email }).returning();
  const [account] = await testDb
    .insert(userAccount)
    .values({ displayName: email, email, active: true, personId: personRow!.personId })
    .returning();
  const [affiliation] = await testDb
    .insert(personAffiliation)
    .values({
      personId: personRow!.personId,
      organizationId: fixtures.organizationId,
      officeId: fixtures.officeId,
      affiliationRoleId: withDelegateRole ? await getDelegateAffiliationRoleId(testDb) : null,
      startedAt: STARTED,
    })
    .returning();
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), affiliationId: affiliation!.personAffiliationId };
}

// A professional who is also their office's delegate, linked as the seed does.
async function createDelegateProfessional(email: string) {
  const created = await createProfessional(email, true);
  const [row] = await testDb.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, created.professionalId));
  // Delegation is read through the account's person.
  await testDb.update(userAccount).set({ personId: row!.personId }).where(eq(userAccount.userAccountId, created.userAccountId));
  await testDb.insert(personAffiliation).values({
    personId: row!.personId,
    organizationId: fixtures.organizationId,
    officeId: fixtures.officeId,
    affiliationRoleId: await getDelegateAffiliationRoleId(testDb),
    startedAt: STARTED,
  });
  return created;
}

async function createCaseAssignedTo(professionalIds: string[]) {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
  });
  for (const professionalId of professionalIds) {
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId,
      assignedAt: new Date('2026-01-15T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
  }
  return caseId;
}

describe('delegated submission', () => {
  it('lets a delegate bill assigned professionals in their office, recorded as the delegate', async () => {
    const first = await createProfessional('first@example.com', true);
    const second = await createProfessional('second@example.com', true);
    const outsider = await createProfessional('outsider@example.com', false);
    const caseId = await createCaseAssignedTo([first.professionalId, second.professionalId, outsider.professionalId]);
    const { actor: delegate } = await createOfficeUser('delegate@example.com', true);

    expect(delegate.professionalId).toBeUndefined();
    expect((await billableProfessionalIds(testDb, delegate, caseId)).sort()).toEqual(
      [first.professionalId, second.professionalId].sort(),
    );

    const { invoiceId } = await createInvoice(testDb, delegate, {
      caseId,
      professionalId: first.professionalId,
      lines: [{ amount: 100 }, { amount: 40, timekeeperProfessionalId: second.professionalId }],
    });

    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(row?.submittedByUserAccountId).toBe(delegate.userAccountId);
    expect(row?.professionalId).toBe(first.professionalId);
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    expect(lines.map((line) => line.timekeeperProfessionalId).sort()).toEqual(
      [first.professionalId, second.professionalId].sort(),
    );
    const events = await testDb.select().from(invoiceEvent).where(eq(invoiceEvent.invoiceId, invoiceId));
    expect(events.every((event) => event.actorUserAccountId === delegate.userAccountId)).toBe(true);

    // Both represented professionals can see it; an unrelated one can't.
    expect(await canPortalReaderReadInvoice(testDb, first, invoiceId)).toBe(true);
    expect(await canPortalReaderReadInvoice(testDb, second, invoiceId)).toBe(true);
    expect(await canPortalReaderReadInvoice(testDb, outsider, invoiceId)).toBe(false);
  });

  it('refuses professionals outside the office or not assigned to the case', async () => {
    const member = await createProfessional('member@example.com', true);
    const unassigned = await createProfessional('unassigned@example.com', true);
    const outsider = await createProfessional('outsider2@example.com', false);
    const caseId = await createCaseAssignedTo([member.professionalId, outsider.professionalId]);
    const { actor: delegate } = await createOfficeUser('delegate2@example.com', true);

    await expect(
      createInvoice(testDb, delegate, { caseId, professionalId: outsider.professionalId, lines: [{ amount: 10 }] }),
    ).rejects.toThrow(NotAssignedToCaseError);
    await expect(
      createInvoice(testDb, delegate, { caseId, professionalId: unassigned.professionalId, lines: [{ amount: 10 }] }),
    ).rejects.toThrow(NotAssignedToCaseError);
    await expect(
      createInvoice(testDb, delegate, {
        caseId,
        professionalId: member.professionalId,
        lines: [{ amount: 10, timekeeperProfessionalId: outsider.professionalId }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('grants nothing for office membership without the delegate role', async () => {
    const member = await createProfessional('member3@example.com', true);
    const caseId = await createCaseAssignedTo([member.professionalId]);
    const { actor: officeUser } = await createOfficeUser('plain@example.com', false);

    expect(await delegateOfficeIds(testDb, officeUser.userAccountId)).toEqual([]);
    expect(await representedProfessionalIds(testDb, officeUser.userAccountId)).toEqual([]);
    await expect(
      createInvoice(testDb, officeUser, { caseId, professionalId: member.professionalId, lines: [{ amount: 10 }] }),
    ).rejects.toThrow(NotAssignedToCaseError);
    await expect(createInvoice(testDb, officeUser, { caseId, lines: [{ amount: 10 }] })).rejects.toThrow(ValidationError);
  });

  it('stops further changes once the delegate affiliation ends', async () => {
    const member = await createProfessional('member4@example.com', true);
    const caseId = await createCaseAssignedTo([member.professionalId]);
    const { actor: delegate, affiliationId } = await createOfficeUser('delegate4@example.com', true);
    const { invoiceId } = await createInvoice(testDb, delegate, { caseId, professionalId: member.professionalId, lines: [{ amount: 10 }] });

    await testDb
      .update(personAffiliation)
      .set({ endedAt: new Date(Date.now() - 1000) })
      .where(eq(personAffiliation.personAffiliationId, affiliationId));

    await expect(recallInvoice(testDb, delegate, invoiceId)).rejects.toThrow(NotAssignedToCaseError);
    // What they submitted stays visible to them.
    expect(await canPortalReaderReadInvoice(testDb, delegate, invoiceId)).toBe(true);
  });

  it('lists cases per person: your own, then each professional you act for', async () => {
    const first = await createProfessional('first5@example.com', true);
    const second = await createProfessional('second5@example.com', true);
    const idle = await createProfessional('idle5@example.com', true);
    const outsider = await createProfessional('outsider5@example.com', false);
    const self = await createDelegateProfessional('self5@example.com');
    const ownCase = await createCaseAssignedTo([self.professionalId]);
    const sharedCase = await createCaseAssignedTo([first.professionalId, second.professionalId]);
    const outsiderCase = await createCaseAssignedTo([outsider.professionalId]);

    const { professionals, cases } = await listPortalCases(testDb, self.userAccountId);

    // Yourself first; everyone you act for, including those with no cases.
    expect(professionals[0]).toMatchObject({ professionalId: self.professionalId, isSelf: true });
    const others = professionals.slice(1);
    expect(others.every((p) => !p.isSelf)).toBe(true);
    expect(others.map((p) => p.professionalId).sort()).toEqual(
      [first.professionalId, second.professionalId, idle.professionalId].sort(),
    );
    const names = others.map((p) => p.displayName ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const byCase = new Map(cases.map((c) => [c.caseId, c.assignedProfessionalIds.sort()]));
    expect(byCase.get(ownCase)).toEqual([self.professionalId]);
    expect(byCase.get(sharedCase)).toEqual([first.professionalId, second.professionalId].sort());
    expect(byCase.has(outsiderCase)).toBe(false);
  });

  it('flags work not yet submitted for approval, per professional', async () => {
    const colleague = await createProfessional('colleague6@example.com', true);
    const self = await createDelegateProfessional('self6@example.com');
    const caseId = await createCaseAssignedTo([self.professionalId, colleague.professionalId]);
    const logTime = (professionalId: string) =>
      createTimeEntry(testDb, self, { caseId, activityOn: '2026-02-01', durationHours: 1, description: 'Work', professionalId });
    const flags = async () => {
      const { cases } = await listPortalCases(testDb, self.userAccountId);
      const [row] = cases;
      return { time: row?.unsubmittedTimeProfessionalIds, invoices: row?.unsubmittedInvoiceProfessionalIds };
    };

    // A delegate reads the time of those they act for, on their cases.
    const billed = await logTime(self.professionalId);
    const colleagueTime = await logTime(colleague.professionalId);
    expect((await timeReadableProfessionalIds(testDb, self, caseId)).sort()).toEqual(
      [self.professionalId, colleague.professionalId].sort(),
    );
    expect((await flags()).time?.sort()).toEqual([self.professionalId, colleague.professionalId].sort());

    await createInvoice(testDb, self, {
      caseId,
      professionalId: colleague.professionalId,
      lines: [{ amount: 10, sourceTimeEntryId: colleagueTime.timeEntryId }],
    });
    await createInvoice(testDb, self, { caseId, lines: [{ amount: 10, sourceTimeEntryId: billed.timeEntryId }] });
    expect(await flags()).toEqual({ time: [], invoices: [] });

    // Time on a draft still counts as unsubmitted.
    const drafted = await logTime(self.professionalId);
    await createInvoice(testDb, self, { caseId, submit: false, lines: [{ amount: 10, sourceTimeEntryId: drafted.timeEntryId }] });
    await createInvoice(testDb, self, { caseId, submit: false, professionalId: colleague.professionalId, lines: [{ amount: 5 }] });
    const { time, invoices } = await flags();
    expect(time).toEqual([self.professionalId]);
    expect(invoices?.sort()).toEqual([self.professionalId, colleague.professionalId].sort());
  });

  it('lets a delegate log time for professionals they act for, recorded as the delegate', async () => {
    const member = await createProfessional('member7@example.com', true);
    const unassigned = await createProfessional('unassigned7@example.com', true);
    const outsider = await createProfessional('outsider7@example.com', false);
    const caseId = await createCaseAssignedTo([member.professionalId, outsider.professionalId]);
    const { actor: delegate } = await createOfficeUser('delegate7@example.com', true);
    const { actor: officeUser } = await createOfficeUser('plain7@example.com', false);
    const entry = { caseId, activityOn: '2026-02-01', durationHours: 1.5, description: 'Hearing prep' };

    const { timeEntryId } = await createTimeEntry(testDb, delegate, { ...entry, professionalId: member.professionalId });
    const [row] = await testDb.select().from(timeEntry).where(eq(timeEntry.timeEntryId, timeEntryId));
    expect(row?.professionalId).toBe(member.professionalId);
    expect(row?.recordedByUserAccountId).toBe(delegate.userAccountId);

    for (const professionalId of [unassigned.professionalId, outsider.professionalId]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(createTimeEntry(testDb, delegate, { ...entry, professionalId })).rejects.toThrow(NotAssignedToCaseError);
    }
    await expect(createTimeEntry(testDb, officeUser, { ...entry, professionalId: member.professionalId })).rejects.toThrow(
      NotAssignedToCaseError,
    );
    // No profile of their own, so they must say whose time it is.
    await expect(createTimeEntry(testDb, delegate, entry)).rejects.toThrow(ValidationError);

    // They can correct it too; office membership alone can't.
    await updateTimeEntry(testDb, delegate, timeEntryId, { ...entry, durationHours: 2 });
    await expect(deleteTimeEntry(testDb, officeUser, timeEntryId)).rejects.toThrow(TimeEntryNotFoundError);
    await deleteTimeEntry(testDb, delegate, timeEntryId);
  });
});
