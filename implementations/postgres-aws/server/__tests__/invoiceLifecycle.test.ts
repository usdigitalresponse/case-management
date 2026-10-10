import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import {
  InvoiceStateError,
  recallInvoice,
  submitInvoice,
  updateDraftInvoice,
  withdrawInvoice,
} from '../src/billing/invoiceLifecycle';
import { reviewInvoiceLine, InvoiceNotFoundError } from '../src/billing/reviewInvoiceLine';
import {
  caseAssignment,
  invoice,
  invoiceApprovalChain,
  invoiceEvent,
  invoiceEventTypes,
  invoiceLine,
  invoiceStatuses,
  userAccount,
} from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function createSubmitter(email: string) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
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
  return { actor: { userAccountId: account!.userAccountId, professionalId }, caseId };
}

async function statusCode(invoiceId: string) {
  const [row] = await testDb
    .select({ code: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  return row?.code;
}

async function eventCodes(invoiceId: string) {
  const rows = await testDb
    .select({ code: invoiceEventTypes.code, actor: invoiceEvent.actorUserAccountId })
    .from(invoiceEvent)
    .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
    .where(eq(invoiceEvent.invoiceId, invoiceId))
    .orderBy(asc(invoiceEvent.sequenceNumber));
  return rows;
}

describe('invoice lifecycle', () => {
  it('saves a draft, edits it, and submits it with a frozen snapshot', async () => {
    const { actor, caseId } = await createSubmitter('lifecycle1@example.com');
    const { invoiceId, submittedTotal } = await createInvoice(testDb, actor, { caseId, submit: false, lines: [{ amount: 10 }] });
    expect(submittedTotal).toBe('10.00');
    expect(await statusCode(invoiceId)).toBe('draft');

    const updated = await updateDraftInvoice(testDb, actor, invoiceId, {
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      lines: [{ amount: 40, description: 'Synthetic research' }, { amount: 2.5 }],
    });
    expect(updated.submittedTotal).toBe('42.50');

    await submitInvoice(testDb, actor, invoiceId);
    expect(await statusCode(invoiceId)).toBe('submitted');
    const [chain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    const snapshot = chain?.submissionSnapshot as { spec_version: string; records: { invoice_line: unknown[] } };
    expect(snapshot.spec_version).toBe('0.3.0');
    expect(snapshot.records.invoice_line).toHaveLength(2);
    expect((await eventCodes(invoiceId)).map((e) => e.code)).toEqual(['draft_created', 'submitted']);

    await expect(updateDraftInvoice(testDb, actor, invoiceId, { lines: [{ amount: 1 }] })).rejects.toThrow(InvoiceStateError);
  });

  it('recalls a submission before review, keeping the earlier attempt', async () => {
    const { actor, caseId } = await createSubmitter('lifecycle2@example.com');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [{ amount: 100 }] });

    await recallInvoice(testDb, actor, invoiceId);
    expect(await statusCode(invoiceId)).toBe('draft');
    const [recalledChain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(recalledChain?.supersededAt).not.toBeNull();

    await updateDraftInvoice(testDb, actor, invoiceId, { lines: [{ amount: 80 }] });
    await submitInvoice(testDb, actor, invoiceId);
    const chains = await testDb
      .select()
      .from(invoiceApprovalChain)
      .where(eq(invoiceApprovalChain.invoiceId, invoiceId))
      .orderBy(asc(invoiceApprovalChain.createdAt));
    expect(chains).toHaveLength(2);
    const amounts = chains.map(
      (chain) => (chain.submissionSnapshot as { records: { invoice_line: Array<{ amount: string }> } }).records.invoice_line[0]?.amount,
    );
    expect(amounts).toEqual(['100.00', '80.00']);
    expect((await eventCodes(invoiceId)).map((e) => e.code)).toEqual(['draft_created', 'submitted', 'recalled', 'submitted']);
  });

  it('blocks recall once a reviewer has decided a line', async () => {
    const { actor, caseId } = await createSubmitter('lifecycle3@example.com');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [{ amount: 100 }, { amount: 50 }] });
    const [line] = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, line!.invoiceLineId, { outcome: 'approved' });

    await expect(recallInvoice(testDb, actor, invoiceId)).rejects.toThrow(InvoiceStateError);
    expect(await statusCode(invoiceId)).toBe('submitted');
  });

  it('withdraws only drafts', async () => {
    const { actor, caseId } = await createSubmitter('lifecycle4@example.com');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [{ amount: 100 }] });
    await expect(withdrawInvoice(testDb, actor, invoiceId)).rejects.toThrow(InvoiceStateError);

    await recallInvoice(testDb, actor, invoiceId);
    await withdrawInvoice(testDb, actor, invoiceId);
    expect(await statusCode(invoiceId)).toBe('withdrawn');
    await expect(submitInvoice(testDb, actor, invoiceId)).rejects.toThrow(InvoiceStateError);
    expect((await eventCodes(invoiceId)).every((e) => e.actor === actor.userAccountId)).toBe(true);
  });

  it("treats another user's invoice as not found", async () => {
    const owner = await createSubmitter('owner@example.com');
    const other = await createSubmitter('other@example.com');
    const { invoiceId } = await createInvoice(testDb, owner.actor, { caseId: owner.caseId, submit: false, lines: [{ amount: 5 }] });

    await expect(submitInvoice(testDb, other.actor, invoiceId)).rejects.toThrow(InvoiceNotFoundError);
    await expect(withdrawInvoice(testDb, other.actor, invoiceId)).rejects.toThrow(InvoiceNotFoundError);
  });

  it('records the final review outcome as an event', async () => {
    const { actor, caseId } = await createSubmitter('lifecycle5@example.com');
    const { invoiceId } = await createInvoice(testDb, actor, { caseId, lines: [{ amount: 100 }] });
    const [line] = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, line!.invoiceLineId, { outcome: 'approved' });

    const events = await eventCodes(invoiceId);
    expect(events.map((e) => e.code)).toEqual(['draft_created', 'submitted', 'approved']);
    expect(events[2]?.actor).toBe(fixtures.staffUserAccountId);
  });
});
