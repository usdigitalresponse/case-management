import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { addKindRate, createKind, setProfessionalKind } from '../src/billing/professionalRates';
import { findBillingOverlaps } from '../src/billing/billingOverlaps';
import { reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { finishReview } from '../src/billing/reviewRounds';
import { setSignOffApprovers } from '../src/billing/reviewAssignment';
import { createStaff } from './reviewHelpers';
import { caseAssignment, invoice, invoiceLine, invoiceStatuses, userAccount } from '../src/db/schema';
import { eq } from 'drizzle-orm';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function investigator(name: string): Promise<PortalActor> {
  const [account] = await testDb
    .insert(userAccount)
    .values({ displayName: name, email: `${randomUUID()}@example.com`, active: true })
    .returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, name);
  const { professionalKindId } = await createKind(testDb, { displayName: `Investigator ${randomUUID()}` });
  await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 100, effectiveFrom: '2026-01-01' });
  await setProfessionalKind(testDb, professionalId, { professionalKindId });
  return resolvePortalActor(testDb, account!.userAccountId);
}

async function caseFor(actors: PortalActor[], caseNumber?: string): Promise<string> {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-01T12:00:00Z'),
    ...(caseNumber ? { caseNumber } : {}),
  });
  for (const actor of actors) {
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId: actor.professionalId!,
      assignedAt: new Date('2026-01-01T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
  }
  return caseId;
}

const time = (serviceDate: string, quantity: number, description: string) => ({ lineType: 'time' as const, serviceDate, quantity, description });

const send = (actor: PortalActor, caseId: string, periodStart: string, periodEnd: string, lines: ReturnType<typeof time>[], submit = true) =>
  createInvoice(testDb, actor, { attested: true, caseId, periodStart, periodEnd, lines, submit });

describe('possible double billing', () => {
  it('lists sent invoices on the same case whose period overlaps, with their lines in the overlap', async () => {
    const actor = await investigator('Synthetic Investigator');
    const caseId = await caseFor([actor]);
    const earlier = await send(actor, caseId, '2026-03-01', '2026-03-15', [time('2026-03-05', 2, 'Interviewed a witness'), time('2026-03-12', 1, 'Notes')]);
    // Before the overlap, unsent, or another person's: not listed.
    await send(actor, caseId, '2026-02-01', '2026-02-28', [time('2026-02-10', 1, 'Earlier work')]);
    await send(actor, caseId, '2026-03-01', '2026-03-31', [time('2026-03-12', 1, 'Draft')], false);
    const colleague = await investigator('Synthetic Colleague');
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId: colleague.professionalId!,
      assignedAt: new Date('2026-01-01T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    await send(colleague, caseId, '2026-03-01', '2026-03-31', [time('2026-03-12', 1, 'Their own work')]);

    const { invoiceId } = await send(actor, caseId, '2026-03-10', '2026-03-31', [time('2026-03-12', 1, 'Notes'), time('2026-03-20', 3, 'Site visit')]);
    const overlaps = await findBillingOverlaps(testDb, invoiceId);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      invoiceId: earlier.invoiceId,
      sameCase: true,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-15',
      statusCode: 'submitted',
    });
    // Only lines inside this invoice's period; the identical one points at its twin.
    expect(overlaps[0]!.lines).toEqual([expect.objectContaining({ serviceDate: '2026-03-12', description: 'Notes', workerDisplayName: 'Synthetic Investigator' })]);
    const own = await findBillingOverlaps(testDb, earlier.invoiceId);
    expect(own.map((overlap) => overlap.invoiceId)).toEqual([invoiceId]);
    expect(overlaps[0]!.lines[0]!.sameAsLineIds).toHaveLength(1);
  });

  it('lists time on another case only on the dates this invoice bills the same person', async () => {
    const actor = await investigator('Synthetic Investigator');
    const caseId = await caseFor([actor]);
    const otherCaseId = await caseFor([actor]);
    const sameDay = await send(actor, otherCaseId, '2026-03-01', '2026-03-31', [
      time('2026-03-05', 4, 'Canvassed for witnesses'),
      time('2026-03-06', 2, 'Another day'),
    ]);
    // The same month on another case, but no shared date: not listed.
    const thirdCaseId = await caseFor([actor]);
    await send(actor, thirdCaseId, '2026-03-01', '2026-03-31', [time('2026-03-25', 2, 'Elsewhere')]);

    const { invoiceId } = await send(actor, caseId, '2026-03-01', '2026-03-31', [time('2026-03-05', 5, 'Interviewed two witnesses')]);
    const overlaps = await findBillingOverlaps(testDb, invoiceId);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ invoiceId: sameDay.invoiceId, sameCase: false, caseId: otherCaseId });
    expect(overlaps[0]!.lines).toEqual([expect.objectContaining({ serviceDate: '2026-03-05', quantity: '4.00', sameAsLineIds: [] })]);
  });

  it('treats a typed case number as the case it names', async () => {
    const actor = await investigator('Synthetic Investigator');
    const caseId = await caseFor([actor], '26-CR-00418');
    await send(actor, caseId, '2026-03-01', '2026-03-15', [time('2026-03-05', 2, 'Interviewed a witness')]);
    const typed = await createInvoice(testDb, actor, {
      attested: true,
      caseId: null,
      caseNumber: '26CR418',
      periodStart: '2026-03-10',
      periodEnd: '2026-03-31',
      lines: [time('2026-03-20', 1, 'Follow-up')],
    });
    const overlaps = await findBillingOverlaps(testDb, typed.invoiceId);
    expect(overlaps).toEqual([expect.objectContaining({ sameCase: true, caseId, lines: [] })]);
  });

  it('leaves out lines a finished round rejected, but counts an invoice sent back to its sender', async () => {
    const actor = await investigator('Synthetic Investigator');
    const caseId = await caseFor([actor]);
    const reviewed = await send(actor, caseId, '2026-03-01', '2026-03-15', [time('2026-03-05', 2, 'Interviewed a witness'), time('2026-03-12', 1, 'Notes')]);
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, reviewed.invoiceId)).orderBy(invoiceLine.serviceDate);
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, reviewed.invoiceId, lines[0]!.invoiceLineId, { outcome: 'approved' });
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, reviewed.invoiceId, lines[1]!.invoiceLineId, {
      outcome: 'rejected',
      reasonCode: 'duplicate',
    });
    await setSignOffApprovers(testDb, fixtures.staffUserAccountId, reviewed.invoiceId, { userAccountIds: [await createStaff('approver')] });
    await finishReview(testDb, fixtures.staffUserAccountId, reviewed.invoiceId);
    const sentBack = await send(actor, caseId, '2026-03-16', '2026-03-31', [time('2026-03-20', 3, 'Site visit')]);
    // As a send-back leaves it: a draft again, still sent.
    const [draft] = await testDb.select({ id: invoiceStatuses.id }).from(invoiceStatuses).where(eq(invoiceStatuses.code, 'draft'));
    await testDb.update(invoice).set({ statusId: draft!.id }).where(eq(invoice.invoiceId, sentBack.invoiceId));

    const { invoiceId } = await send(actor, caseId, '2026-03-10', '2026-03-31', [time('2026-03-12', 1, 'Notes'), time('2026-03-20', 3, 'Site visit')]);
    const overlaps = await findBillingOverlaps(testDb, invoiceId);
    expect(overlaps.find((overlap) => overlap.invoiceId === reviewed.invoiceId)?.lines).toEqual([]);
    expect(overlaps.find((overlap) => overlap.invoiceId === sentBack.invoiceId)?.lines).toEqual([
      expect.objectContaining({ serviceDate: '2026-03-20', sameAsLineIds: [expect.any(String)] }),
    ]);
  });

  it('compares lines dated outside the billing period too', async () => {
    const actor = await investigator('Synthetic Investigator');
    const caseId = await caseFor([actor]);
    const february = await send(actor, caseId, '2026-02-01', '2026-02-28', [time('2026-02-27', 2, 'Interviewed a witness')]);
    const { invoiceId } = await send(actor, caseId, '2026-03-01', '2026-03-31', [time('2026-02-27', 2, 'Interviewed a witness'), time('2026-03-04', 1, 'Notes')]);
    expect(await findBillingOverlaps(testDb, invoiceId)).toEqual([
      expect.objectContaining({ invoiceId: february.invoiceId, sameCase: true, lines: [expect.objectContaining({ serviceDate: '2026-02-27' })] }),
    ]);
  });

  it('shows a submitter only the invoices they may read', async () => {
    const actor = await investigator('Synthetic Investigator');
    const caseId = await caseFor([actor]);
    await send(actor, caseId, '2026-03-01', '2026-03-15', [time('2026-03-05', 2, 'Interviewed a witness')]);
    const { invoiceId } = await send(actor, caseId, '2026-03-10', '2026-03-31', [time('2026-03-12', 1, 'Notes')], false);
    expect(await findBillingOverlaps(testDb, invoiceId, actor)).toHaveLength(1);
    const stranger = await investigator('Synthetic Stranger');
    expect(await findBillingOverlaps(testDb, invoiceId, stranger)).toEqual([]);
  });
});
