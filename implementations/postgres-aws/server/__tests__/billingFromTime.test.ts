import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createTimeEntry } from '../src/portal/createTimeEntry';
import { createInvoice } from '../src/portal/createInvoice';
import { submitInvoice, updateDraftInvoice, withdrawInvoice } from '../src/billing/invoiceLifecycle';
import { addKindRate, createKind, listRates, rateOn, setProfessionalKind } from '../src/billing/professionalRates';
import { isAdmin } from '../src/auth/requireAdmin';
import { getAdminAccountRoleId } from '../src/auth/staffAccountRole';
import { giveRate } from './rateHelpers';
import { billingOfTimeEntry } from '../src/portal/changeTimeEntry';
import { ValidationError } from '../src/errors';
import { auditEvent, caseAssignment, invoice, invoiceLine, timeEntry, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function setup(
  rate?: number,
): Promise<{ actor: PortalActor; professionalId: string; caseId: string; kindId: string | undefined }> {
  const email = `${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: 'Synthetic Professional', email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Synthetic Professional');
  const kindId =
    rate === undefined ? undefined : await giveRate(testDb, fixtures.staffUserAccountId, professionalId, rate, '2026-01-01');
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
  });
  await testDb.insert(caseAssignment).values({
    caseId,
    professionalId,
    assignedAt: new Date('2026-01-15T12:00:00Z'),
    assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
    assignedByUserAccountId: fixtures.staffUserAccountId,
  });
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), professionalId, caseId, kindId };
}

async function linesOf(invoiceId: string) {
  return testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
}

async function billingOf(timeEntryId: string) {
  const [row] = await testDb.select({ billing: billingOfTimeEntry }).from(timeEntry).where(eq(timeEntry.timeEntryId, timeEntryId));
  return row?.billing ?? null;
}

describe('professional kind rates', () => {
  it("uses the professional's kind's rate with the latest start on or before the date", async () => {
    const { professionalId, kindId } = await setup(100);
    await addKindRate(testDb, fixtures.staffUserAccountId, kindId!, { hourlyRate: 150, effectiveFrom: '2026-03-01' });
    const rates = await listRates(testDb, [professionalId]);
    expect(rateOn(rates, professionalId, '2025-12-31')).toBeUndefined();
    expect(rateOn(rates, professionalId, '2026-02-28')).toBe('100.00');
    expect(rateOn(rates, professionalId, '2026-03-01')).toBe('150.00');
    await expect(addKindRate(testDb, fixtures.staffUserAccountId, kindId!, { hourlyRate: 0, effectiveFrom: '2026-04-01' })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses a duplicate kind name', async () => {
    await createKind(testDb, { displayName: 'Investigator' });
    await expect(createKind(testDb, { displayName: 'investigator' })).rejects.toThrow(/already a kind/);
  });

  it('lets only an administrator change settings', async () => {
    expect(await isAdmin(testDb, fixtures.staffUserAccountId)).toBe(false);
    await testDb
      .update(userAccount)
      .set({ systemRoleId: await getAdminAccountRoleId(testDb) })
      .where(eq(userAccount.userAccountId, fixtures.staffUserAccountId));
    expect(await isAdmin(testDb, fixtures.staffUserAccountId)).toBe(true);
  });
});

describe('billing from time', () => {
  const entry = { activityOn: '2026-02-01', durationHours: 1.5, description: 'Hearing preparation' };

  it('prices time lines from the rate, keeping manual amounts for expenses', async () => {
    const { actor, caseId } = await setup(120);
    const { timeEntryId } = await createTimeEntry(testDb, actor, { caseId, ...entry });

    const { invoiceId } = await createInvoice(testDb, actor, {
      caseId,
      lines: [{ sourceTimeEntryId: timeEntryId, amount: 1 }, { lineType: 'expense', amount: 12.5, description: 'Copies' }],
    });

    const lines = await linesOf(invoiceId);
    expect(lines.find((line) => line.sourceTimeEntryId === timeEntryId)).toMatchObject({
      amount: '180.00',
      billedRate: '120.000',
      quantity: '1.50',
      serviceDate: '2026-02-01',
      description: 'Hearing preparation',
    });
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    expect(row?.submittedTotal).toBe('192.50');
    expect(await billingOf(timeEntryId)).toEqual({ invoiceId, statusCode: 'submitted' });
  });

  it('records typed time as a time entry on submission, and says whose rate is missing', async () => {
    const { actor, professionalId, caseId } = await setup();
    const typed = { lineType: 'time' as const, serviceDate: '2026-02-03', quantity: 2, description: 'Client meeting' };

    await expect(createInvoice(testDb, actor, { caseId, lines: [typed] })).rejects.toThrow(
      expect.objectContaining({
        fieldErrors: {
          lines: "Synthetic Professional has no professional kind, so their time can't be priced. Ask an administrator to set one.",
        },
      }),
    );
    await expect(createInvoice(testDb, actor, { caseId, lines: [{ lineType: 'time', amount: 50 }] })).rejects.toThrow(
      ValidationError,
    );

    // A kind whose only rate starts after the work.
    const { professionalKindId } = await createKind(testDb, { displayName: 'Investigator' });
    await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 90, effectiveFrom: '2026-03-01' });
    await setProfessionalKind(testDb, professionalId, { professionalKindId });
    await expect(createInvoice(testDb, actor, { caseId, lines: [typed] })).rejects.toThrow(
      expect.objectContaining({
        fieldErrors: {
          lines:
            "No Investigator rate is set for 2026-02-03, so Synthetic Professional's time can't be priced. Ask an administrator to set one.",
        },
      }),
    );

    await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 90, effectiveFrom: '2026-01-01' });
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [typed] });
    const [line] = await linesOf(invoiceId);
    expect(line).toMatchObject({ amount: '180.00', billedRate: '90.000' });
    const [created] = await testDb.select().from(timeEntry).where(eq(timeEntry.timeEntryId, line!.sourceTimeEntryId as string));
    expect(created).toMatchObject({ professionalId, activityOn: '2026-02-03', durationHours: '2.00', description: 'Client meeting' });
    expect(created?.recordedByUserAccountId).toBe(actor.userAccountId);
  });

  it("saves a draft whose time can't be priced yet, but refuses to submit it", async () => {
    const { actor, caseId } = await setup(100);
    const { invoiceId } = await createInvoice(testDb, actor, {
      caseId,
      submit: false,
      lines: [{ lineType: 'time', quantity: 2, description: 'Undated work' }],
    });
    await expect(submitInvoice(testDb, actor, invoiceId)).rejects.toThrow(
      expect.objectContaining({ fieldErrors: { lines: 'The time item "Undated work" needs a date.' } }),
    );
  });

  it('keeps a time entry on one live invoice, freeing it when that one is withdrawn', async () => {
    const { actor, caseId } = await setup(100);
    const { timeEntryId } = await createTimeEntry(testDb, actor, { caseId, ...entry });
    const { invoiceId: first } = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ sourceTimeEntryId: timeEntryId }] });

    await expect(
      createInvoice(testDb, actor, { caseId, submit: false, lines: [{ sourceTimeEntryId: timeEntryId }] }),
    ).rejects.toThrow(expect.objectContaining({ fieldErrors: { lines: expect.stringMatching(/already on another invoice/) } }));

    await withdrawInvoice(testDb, actor, first);
    expect(await billingOf(timeEntryId)).toBeNull();
    await createInvoice(testDb, actor, { caseId, lines: [{ sourceTimeEntryId: timeEntryId }] });
  });

  it('edits the time entry through its draft line, and frees it when the line is removed', async () => {
    const { actor, caseId } = await setup(100);
    const { timeEntryId } = await createTimeEntry(testDb, actor, { caseId, ...entry });
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ sourceTimeEntryId: timeEntryId }] });

    await updateDraftInvoice(testDb, actor, invoiceId, {
      lines: [{ sourceTimeEntryId: timeEntryId, serviceDate: '2026-02-02', quantity: 2, description: 'Hearing preparation and filing' }],
    });
    const [edited] = await testDb.select().from(timeEntry).where(eq(timeEntry.timeEntryId, timeEntryId));
    expect(edited).toMatchObject({ activityOn: '2026-02-02', durationHours: '2.00', description: 'Hearing preparation and filing' });
    const [line] = await linesOf(invoiceId);
    expect(line?.amount).toBe('200.00');
    const [history] = await testDb.select().from(auditEvent).where(eq(auditEvent.entityId, timeEntryId));
    expect((history?.priorValues as { durationHours: string }).durationHours).toBe('1.50');

    await updateDraftInvoice(testDb, actor, invoiceId, { lines: [{ lineType: 'other', amount: 10 }] });
    expect(await billingOf(timeEntryId)).toBeNull();
  });

  it('never reprices a submitted invoice when a rate changes later', async () => {
    const { actor, caseId, kindId } = await setup(100);
    const { timeEntryId } = await createTimeEntry(testDb, actor, { caseId, ...entry });
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ sourceTimeEntryId: timeEntryId }] });
    await submitInvoice(testDb, actor, invoiceId);

    await addKindRate(testDb, fixtures.staffUserAccountId, kindId!, { hourlyRate: 300, effectiveFrom: '2026-01-01' });
    const [line] = await linesOf(invoiceId);
    expect(line).toMatchObject({ amount: '150.00', billedRate: '100.000' });
  });
});
