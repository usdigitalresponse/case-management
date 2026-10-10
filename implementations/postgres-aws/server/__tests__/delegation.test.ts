import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getDelegateAffiliationRoleId } from '../src/professionals/delegateRole';
import { createInvoice } from '../src/portal/createInvoice';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';
import { billableProfessionalIds, delegateOfficeIds, representedProfessionalIds, resolvePortalActor } from '../src/portal/portalActor';
import { recallInvoice } from '../src/billing/invoiceLifecycle';
import { canPortalReaderReadInvoice } from '../src/billing/invoiceAccess';
import { ValidationError } from '../src/errors';
import { caseAssignment, invoice, invoiceEvent, invoiceLine, person, personAffiliation, professional, userAccount } from '../src/db/schema';

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
});
