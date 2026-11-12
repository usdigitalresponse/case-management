import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import {
  repriceLines,
  reviewInvoiceLine,
  undoLineDecision,
  InvoiceLineNotFoundError,
  InvoiceNotFoundError,
  InvoiceNotInReviewError,
} from '../src/billing/reviewInvoiceLine';
import { finishReview, markCompleted, reopenReview, signOffInvoice } from '../src/billing/reviewRounds';
import { reassignReviewer, setSignOffApprovers } from '../src/billing/reviewAssignment';
import { setReviewSettings } from '../src/billing/reviewSettings';
import { decisionCommentsOf, loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { invoiceExportContent } from '../src/billing/exportInvoice';
import { listReviewQueue, type QueueRow, type QueueView } from '../src/billing/reviewQueue';
import { listReviewQueueBatch, type QueueBatchRequest, type QueueShow } from '../src/billing/reviewQueueBatches';
import { loadBillingRecord } from '../src/billing/billingRecord';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceEvent,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  preauthorization,
  preauthorizationDecision,
  preauthorizationOutcomes,
  preauthorizationStatuses,
  userAccount,
} from '../src/db/schema';
import { loadPreauthorizationSummaries } from '../src/billing/preauthorizations';
import { getReferenceId } from '../src/db/referenceLookups';

let fixtures: BaselineFixtureIds;
let reviewer: string;
let approver: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  reviewer = await createStaff('reviewer', 'Reviewer One');
  approver = await createStaff('approver', 'Approver One');
});

afterAll(async () => {
  await testPool.end();
});

function baseCaseInput(overrides: Partial<CreateCaseInput> = {}): CreateCaseInput {
  return {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

async function createProfessional(): Promise<{ userAccountId: string; professionalId: string }> {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  const professionalId = await ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
  return { userAccountId: account.userAccountId, professionalId };
}

type LineSpec =
  | string
  | { amount: string; quantity: string; billedRate: string; configuredRate?: string; unitRate?: string; statedAmount?: string; position?: number };

async function createInvoiceWithLines(specs: LineSpec[], statusCode = 'submitted') {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
  const { userAccountId, professionalId } = await createProfessional();
  const lines = specs.map((spec) => (typeof spec === 'string' ? { amount: spec } : spec));
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: userAccountId,
      professionalId,
      statusId: await getReferenceId(testDb, invoiceStatuses, statusCode),
      submittedAt: new Date(),
      submittedTotal: lines.reduce((sum, line) => sum + Number(line.amount), 0).toFixed(2),
      caseId,
    })
    .returning();
  if (!row) {
    throw new Error('Expected insert to return a row.');
  }
  await testDb.insert(invoiceApprovalChain).values({ invoiceId: row.invoiceId, createdByUserAccountId: userAccountId, createdAt: new Date() });
  const timeTypeId = await getReferenceId(testDb, invoiceLineTypes, 'time');
  const inserted = await testDb
    .insert(invoiceLine)
    .values(
      lines.map((line) => ({
        invoiceId: row.invoiceId,
        caseId,
        lineTypeId: 'quantity' in line ? timeTypeId : fixtures.invoiceLineTypeSampleId,
        ...line,
      })),
    )
    .returning();
  return { invoiceId: row.invoiceId, lineIds: inserted.map((line) => line.invoiceLineId) };
}

async function statusCode(invoiceId: string) {
  const [row] = await testDb
    .select({ code: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  return row?.code;
}

async function recordedCount(invoiceId: string) {
  const rows = await testDb
    .select({ id: invoiceApprovalDecision.invoiceApprovalDecisionId })
    .from(invoiceApprovalDecision)
    .innerJoin(invoiceApprovalChain, eq(invoiceApprovalDecision.invoiceApprovalChainId, invoiceApprovalChain.invoiceApprovalChainId))
    .where(eq(invoiceApprovalChain.invoiceId, invoiceId));
  return rows.length;
}

describe('line decisions', () => {
  it('takes an unassigned invoice, starts review and records nothing until finished', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);

    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });

    expect(await statusCode(invoiceId)).toBe('under_review');
    expect(await recordedCount(invoiceId)).toBe(0);
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.assignments?.reviewer?.userAccountId).toBe(reviewer);
    expect(detail.lines.find((line) => line.invoiceLineId === lineIds[0])?.working).toMatchObject({
      outcomeCode: 'approved',
      approvedAmount: '70.00',
    });
    // Submitters never see working decisions.
    const submitterView = (await loadInvoiceDetail(testDb, invoiceId))!;
    expect(submitterView.lines.every((line) => line.working === null)).toBe(true);
  });

  it('prices a partial approval from corrected hours, or from the amount when a line has none', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines([
      { amount: '125.00', quantity: '1.00', billedRate: '125.00' },
      '40.00',
    ]);

    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, {
      outcome: 'approved_in_part',
      approvedQuantity: 0.2,
      reasonCode: 'not_billable',
      note: 'Updates are office overhead.',
    });
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, {
      outcome: 'approved_in_part',
      approvedAmount: 30,
      reasonCode: 'duplicate',
    });

    const lines = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(lines.find((line) => line.invoiceLineId === lineIds[0])?.working).toMatchObject({
      outcomeCode: 'approved_in_part',
      approvedAmount: '25.00',
      reasonCode: 'not_billable',
    });
    expect(lines.find((line) => line.invoiceLineId === lineIds[1])?.working?.approvedAmount).toBe('30.00');
  });

  it('requires a reason to approve in part or reject, and a note for another reason', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    const line = lineIds[0]!;

    await expect(reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'rejected' })).rejects.toThrow(ValidationError);
    await expect(
      reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved_in_part', approvedAmount: 10 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'rejected', reasonCode: 'other' }),
    ).rejects.toThrow(ValidationError);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'rejected', reasonCode: 'other', note: 'Not ours.' });
  });

  it('takes reasons only from the list for the outcome', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    const line = lineIds[0]!;
    await expect(
      reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'rejected', reasonCode: 'not_billable' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved_in_part', approvedAmount: 10, reasonCode: 'block_billing' }),
    ).rejects.toThrow(ValidationError);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'rejected', reasonCode: 'no_backup' });
    await reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved_in_part', approvedAmount: 10, reasonCode: 'not_billable' });
  });

  it('keeps a partial approval above nothing and below the request', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    for (const approvedAmount of [70, 70.01, 0.001]) {
      await expect(
        reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved_in_part', approvedAmount, reasonCode: 'duplicate' }),
      ).rejects.toThrow(ValidationError);
    }
  });

  it('lets the reviewer change and undo a decision without history', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'rejected', reasonCode: 'duplicate' });
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await undoLineDecision(testDb, reviewer, invoiceId, lineIds[0]!);

    const [line] = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(line?.working).toBeNull();
    expect(await recordedCount(invoiceId)).toBe(0);
  });

  it('lets any active staff member decide, keeping the invoice with its reviewer', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    const deactivated = await createStaff('staff');
    await testDb.update(userAccount).set({ active: false }).where(eq(userAccount.userAccountId, deactivated));
    await expect(reviewInvoiceLine(testDb, deactivated, invoiceId, lineIds[0]!, { outcome: 'approved' })).rejects.toThrow(ForbiddenError);

    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    // Anyone on staff may decide a line on an invoice someone else reviews; it stays theirs.
    const other = await createStaff('staff');
    await reviewInvoiceLine(testDb, other, invoiceId, lineIds[0]!, { outcome: 'rejected', reasonCode: 'duplicate' });
    const detail = await loadInvoiceDetail(testDb, invoiceId, 'staff');
    expect(detail?.assignments?.reviewer?.userAccountId).toBe(reviewer);

    // Any staff member may give it to themselves, keeping the decisions made.
    await reassignReviewer(testDb, other, invoiceId, { userAccountId: other });
    await reviewInvoiceLine(testDb, other, invoiceId, lineIds[0]!, { outcome: 'approved' });
  });

  it('rejects drafts, other invoices’ lines and unknown ids', async () => {
    const draft = await createInvoiceWithLines(['70.00'], 'draft');
    await expect(reviewInvoiceLine(testDb, reviewer, draft.invoiceId, draft.lineIds[0]!, { outcome: 'approved' })).rejects.toThrow(
      InvoiceNotInReviewError,
    );
    const first = await createInvoiceWithLines(['70.00']);
    const second = await createInvoiceWithLines(['50.00']);
    await expect(
      reviewInvoiceLine(testDb, reviewer, first.invoiceId, second.lineIds[0]!, { outcome: 'approved' }),
    ).rejects.toThrow(InvoiceLineNotFoundError);
    await expect(reviewInvoiceLine(testDb, reviewer, randomUUID(), randomUUID(), { outcome: 'approved' })).rejects.toThrow(
      InvoiceNotFoundError,
    );
    await expect(reviewInvoiceLine(testDb, reviewer, first.invoiceId, 'not-a-uuid', { outcome: 'approved' })).rejects.toThrow(
      InvoiceLineNotFoundError,
    );
  });

  it('re-prices undecided time lines billed above the configured rate', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines([
      { amount: '1190.00', quantity: '2.00', billedRate: '595.00', configuredRate: '125.00' },
      { amount: '125.00', quantity: '1.00', billedRate: '125.00', configuredRate: '125.00' },
    ]);

    expect(await repriceLines(testDb, reviewer, invoiceId)).toMatchObject({ repriced: 1 });
    const lines = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(lines.find((line) => line.invoiceLineId === lineIds[0])?.working).toMatchObject({
      outcomeCode: 'approved_in_part',
      approvedAmount: '250.00',
      reasonCode: 'rate_above_configured',
    });
    expect(lines.find((line) => line.invoiceLineId === lineIds[1])?.working).toBeNull();
  });

  it('lets a reviewer raise or lower a rate without a reason, flagged for sign-off', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines([
      { amount: '250.00', quantity: '2.00', billedRate: '125.00', configuredRate: '125.00' },
      '40.00',
    ]);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved', approvedRate: 150 });
    const lines = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(lines.find((line) => line.invoiceLineId === lineIds[0])?.working).toMatchObject({
      outcomeCode: 'approved',
      approvedAmount: '300.00',
      approvedRate: '150.000',
      reasonCode: null,
    });
    await expect(reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, { outcome: 'approved', approvedRate: 10 })).rejects.toThrow(
      ValidationError,
    );
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, { outcome: 'approved' });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await finishReview(testDb, reviewer, invoiceId);
    const [queued] = (await listReviewQueue(testDb, 'open')).invoices.filter((row) => row.invoiceId === invoiceId);
    expect(queued?.flags).toContainEqual({ kind: 'rate_changed', message: 'Reviewer changed the rate on 1 line' });
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.approvedTotal).toBe('340.00');
  });

  it("flags in the queue the highest rate above its limit and the first whose stated amount doesn't add up", async () => {
    const { invoiceId } = await createInvoiceWithLines([
      { amount: '280.00', quantity: '2.00', billedRate: '140.00', configuredRate: '125.00', position: 0 },
      { amount: '300.00', quantity: '2.00', billedRate: '150.00', configuredRate: '125.00', position: 4 },
      { amount: '290.00', quantity: '2.00', billedRate: '145.00', configuredRate: '130.00', position: 5 },
      // 151.575, rounded half up.
      { amount: '151.58', quantity: '7.05', billedRate: '21.50', unitRate: '21.50', statedAmount: '151.58', position: 1 },
      { amount: '15.00', quantity: '1.50', billedRate: '10.00', unitRate: '10.00', statedAmount: '16.00', position: 2 },
      { amount: '15.00', quantity: '1.00', billedRate: '10.00', unitRate: '10.00', statedAmount: '12.00', position: 3 },
    ]);
    const [queued] = (await listReviewQueue(testDb, 'all')).invoices.filter((row) => row.invoiceId === invoiceId);
    expect(queued?.lineCount).toBe(6);
    expect(queued?.flags).toEqual([
      { kind: 'rate', message: 'Rate check: bills $150.00 an hour, approved rate $125.00' },
      { kind: 'arithmetic', message: 'One line does not add up: 1.50 × $10.00 is not $16.00' },
    ]);
  });

  it('checks and re-prices against the pre-authorized rate when the case has one', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines([
      { amount: '1190.00', quantity: '2.00', billedRate: '595.00', configuredRate: '125.00' },
      { amount: '140.00', quantity: '1.00', billedRate: '140.00', configuredRate: '125.00' },
    ]);
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
    const [preauth] = await testDb
      .insert(preauthorization)
      .values({
        caseId: row!.caseId!,
        professionalId: row!.professionalId,
        statusId: await getReferenceId(testDb, preauthorizationStatuses, 'approved'),
        requestedAt: new Date(),
      })
      .returning();
    await testDb.insert(preauthorizationDecision).values({
      preauthorizationId: preauth!.preauthorizationId,
      sequenceNumber: 1,
      outcomeId: await getReferenceId(testDb, preauthorizationOutcomes, 'approved'),
      approvedAmount: '2000.00',
      approvedHourlyRate: '150.00',
      effectiveAt: new Date(),
      decidedAt: new Date(),
      decidedByUserAccountId: fixtures.staffUserAccountId,
    });

    const before = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(before.map((line) => [line.rateLimit, line.rateLimitSource])).toEqual([
      ['150.00', 'preauthorized'],
      ['150.00', 'preauthorized'],
    ]);
    // 140 is above the configured 125 but within the pre-authorized 150.
    expect(await repriceLines(testDb, reviewer, invoiceId)).toMatchObject({ repriced: 1 });
    const lines = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines;
    expect(lines.find((line) => line.invoiceLineId === lineIds[0])?.working).toMatchObject({ approvedAmount: '300.00', approvedRate: '150.000' });
    expect(lines.find((line) => line.invoiceLineId === lineIds[1])?.working).toBeNull();
  });
});

describe('finishing and sign-off', () => {
  async function decideAll(invoiceId: string, lineIds: string[]) {
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'rejected', reasonCode: 'duplicate' });
    for (const lineId of lineIds.slice(1)) {
      await reviewInvoiceLine(testDb, reviewer, invoiceId, lineId, { outcome: 'approved' });
    }
  }

  it('records a round only when every line is decided, then signs off to approval', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'rejected', reasonCode: 'duplicate' });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await expect(finishReview(testDb, reviewer, invoiceId)).rejects.toThrow(ValidationError);

    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId);
    expect(await statusCode(invoiceId)).toBe('awaiting_sign_off');
    expect(await recordedCount(invoiceId)).toBe(2);

    // A rejected line doesn't reject the invoice.
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' });
    expect(await statusCode(invoiceId)).toBe('approved');
    const detail = (await loadInvoiceDetail(testDb, invoiceId))!;
    expect(detail.approvedTotal).toBe('50.00');
  });

  it('marks a decided invoice completed once, leaving it approved', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await finishReview(testDb, reviewer, invoiceId);
    await expect(markCompleted(testDb, reviewer, invoiceId)).rejects.toThrow(ConflictError);

    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' });
    await testDb.update(invoiceEvent).set({ occurredAt: new Date('2026-01-05T12:00:00Z') }).where(eq(invoiceEvent.invoiceId, invoiceId));
    const submitter = await createProfessional();
    await expect(markCompleted(testDb, submitter.userAccountId, invoiceId)).rejects.toThrow(ForbiddenError);
    const { completedAt } = await markCompleted(testDb, await createStaff('staff', 'Staff One'), invoiceId);
    expect(completedAt).toBeInstanceOf(Date);
    expect((await markCompleted(testDb, reviewer, invoiceId)).completedAt).toEqual(completedAt);
    expect(await statusCode(invoiceId)).toBe('approved');
    const [row] = (await listReviewQueue(testDb, 'finished')).invoices;
    expect(row?.completedAt).toEqual(completedAt);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice.completedAt).toEqual(completedAt);
    expect((await loadInvoiceDetail(testDb, invoiceId))!.invoice.completedAt).toBeNull();
    const [exported] = await loadBillingRecord(testDb);
    expect(exported?.['Status changed']).toBe('2026-01-05');
  });

  it('needs someone to sign off before finishing', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await expect(finishReview(testDb, reviewer, invoiceId)).rejects.toThrow(ValidationError);
  });

  it('reopens before sign-off as a new round, keeping the first', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await decideAll(invoiceId, lineIds);
    await finishReview(testDb, reviewer, invoiceId);

    await reopenReview(testDb, reviewer, invoiceId);
    expect(await statusCode(invoiceId)).toBe('under_review');
    // Starts from the finished round's decisions.
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await finishReview(testDb, reviewer, invoiceId);

    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    const first = detail.lines.find((line) => line.invoiceLineId === lineIds[0])!;
    expect(first.decision?.outcomeCode).toBe('approved');
    expect(first.history).toHaveLength(1);
    expect(first.history[0]?.outcomeCode).toBe('rejected');
    expect(detail.approvedTotal).toBe('120.00');
  });

  it('totals a pre-authorization against approved and waiting invoices', async () => {
    const approved = await createInvoiceWithLines(['70.00', '50.00']);
    const [row] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, approved.invoiceId));
    const waiting = await createInvoiceWithLines(['30.00']);
    // Same case and professional as the first.
    await testDb.update(invoice).set({ caseId: row!.caseId, professionalId: row!.professionalId }).where(eq(invoice.invoiceId, waiting.invoiceId));
    await testDb.update(invoiceLine).set({ caseId: row!.caseId }).where(eq(invoiceLine.invoiceId, waiting.invoiceId));
    const [preauth] = await testDb
      .insert(preauthorization)
      .values({
        caseId: row!.caseId!,
        professionalId: row!.professionalId,
        statusId: await getReferenceId(testDb, preauthorizationStatuses, 'approved'),
        requestedAt: new Date(),
      })
      .returning();
    for (const [sequenceNumber, approvedAmount] of [[1, '200.00'], [2, '150.00']] as const) {
      await testDb.insert(preauthorizationDecision).values({
        preauthorizationId: preauth!.preauthorizationId,
        sequenceNumber,
        outcomeId: await getReferenceId(testDb, preauthorizationOutcomes, sequenceNumber === 1 ? 'approved' : 'revised'),
        approvedAmount,
        effectiveAt: new Date(),
        decidedAt: new Date(),
        decidedByUserAccountId: fixtures.staffUserAccountId,
      });
    }
    await setSignOffApprovers(testDb, reviewer, approved.invoiceId, { userAccountIds: [approver] });
    await decideAll(approved.invoiceId, approved.lineIds);
    await finishReview(testDb, reviewer, approved.invoiceId);
    await signOffInvoice(testDb, approver, approved.invoiceId, { outcome: 'approved' });

    // The latest ceiling replaces the first; the rejected line isn't counted.
    expect(await loadPreauthorizationSummaries(testDb, row!.caseId!)).toEqual([
      expect.objectContaining({ ceiling: '150.00', approvedSoFar: '50.00', waiting: '30.00' }),
    ]);
  });

  it('lets anyone on staff finish, keeping who decided each line and who finished', async () => {
    const other = await createStaff('staff', 'Staff Two');
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await reviewInvoiceLine(testDb, other, invoiceId, lineIds[1]!, { outcome: 'approved' });
    // Two people decided lines, so the reviewer may sign off.
    await setSignOffApprovers(testDb, other, invoiceId, { userAccountIds: [reviewer] });
    await finishReview(testDb, other, invoiceId);

    const recorded = await testDb
      .select({ invoiceLineId: invoiceApprovalDecision.invoiceLineId, by: invoiceApprovalDecision.decidedByUserAccountId })
      .from(invoiceApprovalDecision)
      .innerJoin(invoiceApprovalChain, eq(invoiceApprovalChain.invoiceApprovalChainId, invoiceApprovalDecision.invoiceApprovalChainId))
      .where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(Object.fromEntries(recorded.map((row) => [row.invoiceLineId, row.by]))).toEqual({ [lineIds[0]!]: reviewer, [lineIds[1]!]: other });
    const finished = await testDb
      .select({ actor: invoiceEvent.actorUserAccountId })
      .from(invoiceEvent)
      .where(eq(invoiceEvent.invoiceId, invoiceId));
    expect(finished.at(-1)?.actor).toBe(other);

    await signOffInvoice(testDb, reviewer, invoiceId, { outcome: 'approved' });
    expect(await statusCode(invoiceId)).toBe('approved');
  });

  it('needs at least two people to take part', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [reviewer] });
    await expect(finishReview(testDb, reviewer, invoiceId)).rejects.toMatchObject({
      fieldErrors: { signOff: expect.stringContaining('two people') },
    });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await finishReview(testDb, reviewer, invoiceId);
  });

  it('rejects a whole invoice at sign-off, approving nothing, with a comment shared like line notes', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await decideAll(invoiceId, lineIds);
    await finishReview(testDb, reviewer, invoiceId);
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'rejected', comment: 'Not billable to this office.' });

    expect(await statusCode(invoiceId)).toBe('rejected');
    const staffView = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(staffView.approvedTotal).toBe('0.00');
    expect(staffView.signOffs.at(-1)).toMatchObject({ outcomeCode: 'rejected', comment: 'Not billable to this office.' });
    const submitterView = (await loadInvoiceDetail(testDb, invoiceId))!;
    expect(submitterView.signOffs.at(-1)).toMatchObject({ comment: 'Not billable to this office.', internalOnly: false });
    expect(invoiceExportContent(submitterView, { includeReviewer: false, exportedAt: new Date() }).summary).toContainEqual([
      'Decision comment',
      'Not billable to this office.',
    ]);
  });

  it('lets only the named approvers sign off when Settings says so', async () => {
    await expect(setReviewSettings(testDb, fixtures.staffUserAccountId, { signOffBy: 'approvers' })).rejects.toThrow(ValidationError);
    await setReviewSettings(testDb, fixtures.staffUserAccountId, { signOffBy: 'approvers', signOffApproverUserAccountIds: [approver] });
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await expect(setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [reviewer] })).rejects.toThrow(ValidationError);
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await finishReview(testDb, reviewer, invoiceId);

    // Taken off the list after being chosen, they can't sign until it allows anyone again.
    await setReviewSettings(testDb, fixtures.staffUserAccountId, { signOffApproverUserAccountIds: [reviewer] });
    await expect(signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' })).rejects.toThrow(ForbiddenError);
    await setReviewSettings(testDb, fixtures.staffUserAccountId, { signOffBy: 'anyone' });
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' });
    expect(await statusCode(invoiceId)).toBe('approved');
  });

  it('keeps saving other settings after a named approver is deactivated', async () => {
    const admin = fixtures.staffUserAccountId;
    const saved = await setReviewSettings(testDb, admin, {
      signOffBy: 'approvers',
      signOffApproverUserAccountIds: [approver, reviewer],
      defaultSignOffUserAccountIds: [approver],
    });
    await testDb.update(userAccount).set({ active: false }).where(eq(userAccount.userAccountId, reviewer));
    // The page sends every setting back.
    expect((await setReviewSettings(testDb, admin, { ...saved, waitingAlertWorkingDays: 12 })).waitingAlertWorkingDays).toBe(12);
    await expect(setReviewSettings(testDb, admin, { defaultSignOffUserAccountIds: [approver, reviewer] })).rejects.toThrow(ValidationError);
  });

  it('signs off in order and sends back to the reviewer with an internal comment', async () => {
    const second = await createStaff('approver', 'Approver Two');
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00', '50.00']);
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver, second] });
    await decideAll(invoiceId, lineIds);
    await finishReview(testDb, reviewer, invoiceId);

    await expect(signOffInvoice(testDb, second, invoiceId, { outcome: 'approved' })).rejects.toThrow(ConflictError);
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' });
    expect(await statusCode(invoiceId)).toBe('awaiting_sign_off');
    await expect(reopenReview(testDb, reviewer, invoiceId)).rejects.toThrow(ConflictError);

    await expect(signOffInvoice(testDb, second, invoiceId, { outcome: 'changes_requested' })).rejects.toThrow(ValidationError);
    await signOffInvoice(testDb, second, invoiceId, { outcome: 'changes_requested', comment: 'Check the duplicate.' });
    expect(await statusCode(invoiceId)).toBe('under_review');

    const staffView = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(staffView.signOffs.at(-1)?.comment).toBe('Check the duplicate.');
    expect(staffView.lines.every((line) => line.working !== null)).toBe(true);
    const submitterView = (await loadInvoiceDetail(testDb, invoiceId))!;
    expect(submitterView.signOffs.every((signOff) => signOff.comment === null)).toBe(true);
    const exported = invoiceExportContent(staffView, { includeReviewer: true, exportedAt: new Date() }).summary;
    expect(exported.map(([name]) => name)).not.toContain('Decision comment');

    // The next round needs both sign-offs again.
    await finishReview(testDb, reviewer, invoiceId);
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' });
    await signOffInvoice(testDb, second, invoiceId, { outcome: 'approved', comment: 'Approved after the check.' });
    expect(await statusCode(invoiceId)).toBe('approved');

    // The submitter sees the approval's comment, never the send-back's.
    const sent = decisionCommentsOf((await loadInvoiceDetail(testDb, invoiceId))!.signOffs);
    expect(sent).toEqual([expect.objectContaining({ outcomeCode: 'approved', comment: 'Approved after the check.' })]);
    expect(decisionCommentsOf(staffView.signOffs)).toEqual([]);
  });
});

describe('the queue a batch at a time', () => {
  // Every batch, two at a time, so each cursor is used.
  async function allBatches(request: Omit<QueueBatchRequest, 'actorUserAccountId'>, actorUserAccountId: string) {
    const items: QueueRow[] = [];
    let after: string | null = null;
    let batches = 0;
    do {
      const batch: Awaited<ReturnType<typeof listReviewQueueBatch>> = await listReviewQueueBatch(
        testDb,
        { ...request, actorUserAccountId },
        { limit: 2, after: after ? JSON.parse(Buffer.from(after, 'base64url').toString()) : null },
      );
      items.push(...batch.items);
      after = batch.next;
      batches += 1;
    } while (after && batches < 50);
    return items;
  }

  it('lists, filters and counts the same invoices as the whole queue', async () => {
    const second = await createStaff('approver', 'Approver Two');
    const unassigned = await createInvoiceWithLines(['10.00']);
    const flagged = await createInvoiceWithLines([{ amount: '15.00', quantity: '1.00', billedRate: '10.00', unitRate: '10.00', statedAmount: '12.00' }]);
    const reviewing = await createInvoiceWithLines(['20.00', '30.00']);
    await reviewInvoiceLine(testDb, reviewer, reviewing.invoiceId, reviewing.lineIds[0]!, { outcome: 'approved' });
    // Waiting on the second approver once the first signed off.
    const signing = await createInvoiceWithLines(['40.00']);
    await setSignOffApprovers(testDb, reviewer, signing.invoiceId, { userAccountIds: [approver, second] });
    await reviewInvoiceLine(testDb, reviewer, signing.invoiceId, signing.lineIds[0]!, { outcome: 'approved' });
    await finishReview(testDb, reviewer, signing.invoiceId);
    await signOffInvoice(testDb, approver, signing.invoiceId, { outcome: 'approved' });
    const signedOff = await createInvoiceWithLines(['50.00']);
    await setSignOffApprovers(testDb, reviewer, signedOff.invoiceId, { userAccountIds: [approver] });
    await reviewInvoiceLine(testDb, reviewer, signedOff.invoiceId, signedOff.lineIds[0]!, { outcome: 'approved' });
    await finishReview(testDb, reviewer, signedOff.invoiceId);
    await signOffInvoice(testDb, approver, signedOff.invoiceId, { outcome: 'approved' });
    const completed = await createInvoiceWithLines(['60.00']);
    await setSignOffApprovers(testDb, reviewer, completed.invoiceId, { userAccountIds: [approver] });
    await reviewInvoiceLine(testDb, reviewer, completed.invoiceId, completed.lineIds[0]!, { outcome: 'approved' });
    await finishReview(testDb, reviewer, completed.invoiceId);
    await signOffInvoice(testDb, approver, completed.invoiceId, { outcome: 'approved' });
    await markCompleted(testDb, reviewer, completed.invoiceId);
    // Received by staff a while ago, so it waits longest.
    await testDb.update(invoice).set({ receivedOn: '2026-01-05' }).where(eq(invoice.invoiceId, unassigned.invoiceId));

    const month = new Date().toISOString().slice(0, 7);
    const views: Array<[QueueView, QueueShow[]]> = [
      ['open', ['all', 'mine', 'unassigned', 'flagged']],
      ['lines_decided', ['all', 'month', 'sign_off', 'decided', 'completed', 'approved']],
      ['all', ['all', 'waiting', 'done']],
    ];
    for (const actor of [reviewer, second]) {
      for (const [view, shows] of views) {
        const whole = (await listReviewQueue(testDb, view, { actorUserAccountId: actor })).invoices;
        const expected: Record<QueueShow, (row: QueueRow) => boolean> = {
          all: () => true,
          mine: (row) => row.holder?.userAccountId === actor,
          unassigned: (row) => !row.reviewer,
          flagged: (row) => row.flags.length > 0,
          month: (row) => Boolean(row.finishedAt?.toISOString().startsWith(month)),
          sign_off: (row) => row.statusCode === 'awaiting_sign_off',
          decided: (row) => row.statusCode !== 'awaiting_sign_off' && !row.completedAt,
          completed: (row) => row.statusCode !== 'awaiting_sign_off' && Boolean(row.completedAt),
          approved: (row) => row.statusCode === 'approved',
          waiting: (row) => !['approved', 'rejected'].includes(row.statusCode ?? ''),
          done: (row) => ['approved', 'rejected'].includes(row.statusCode ?? ''),
        };
        const first = await listReviewQueueBatch(testDb, { view, counts: shows, actorUserAccountId: actor }, { limit: 50, after: null });
        for (const show of shows) {
          const wanted = whole.filter(expected[show]).map((row) => row.invoiceId);
          const sort = view === 'open' ? 'waiting' : 'finished';
          const got = await allBatches({ view, show, sort }, actor);
          expect(got.map((row) => row.invoiceId).sort(), `${view} ${show}`).toEqual([...wanted].sort());
          expect(got.map((row) => withoutVolatile(row)).sort(byId)).toEqual(whole.filter(expected[show]).map(withoutVolatile).sort(byId));
          if (show !== 'flagged') expect(first.summary?.counts[show], `${view} ${show} count`).toBe(wanted.length);
        }
      }
    }
    const waiting = await allBatches({ view: 'open', sort: 'waiting' }, reviewer);
    expect(waiting[0]?.invoiceId).toBe(unassigned.invoiceId);
    expect(waiting.map((row) => row.workingDaysWaiting)).toEqual([...waiting.map((row) => row.workingDaysWaiting)].sort((a, b) => b - a));
    const newest = await allBatches({ view: 'all', sort: 'newest' }, reviewer);
    expect(newest.map((row) => row.submittedAt?.getTime())).toEqual(newest.map((row) => row.submittedAt?.getTime()).sort((a, b) => b! - a!));
    expect((await allBatches({ view: 'open', q: 'nobody-matches-this' }, reviewer)).length).toBe(0);
    const whole = (await listReviewQueue(testDb, 'all')).invoices;
    for (const row of whole) {
      const { summary } = await listReviewQueueBatch(testDb, { view: 'all', professionalId: row.professionalId!, actorUserAccountId: reviewer }, { limit: 1, after: null });
      expect(summary?.person, row.statusCode ?? undefined).toEqual({
        total: 1,
        thisYear: { count: 1, requested: row.submittedTotal, approved: row.approvedTotal ?? '0.00' },
        waiting: { count: ['approved', 'rejected'].includes(row.statusCode ?? '') ? 0 : 1, requested: ['approved', 'rejected'].includes(row.statusCode ?? '') ? '0.00' : row.submittedTotal },
      });
    }
    const { summary: searched } = await listReviewQueueBatch(testDb, { view: 'all', q: 'vendor', actorUserAccountId: reviewer }, { limit: 1, after: null });
    expect(searched?.search).toMatchObject({ exact: { count: whole.length }, close: { count: 0, invoices: [] }, people: whole.length });
    await testDb.update(invoice).set({ caseNumberAsTyped: '26-CR-00418' }).where(eq(invoice.invoiceId, flagged.invoiceId));
    await testDb.update(invoice).set({ caseNumberAsTyped: '26 cr 418' }).where(eq(invoice.invoiceId, reviewing.invoiceId));
    const byNumber = await allBatches({ view: 'all', q: '26-CR-00418', sort: 'search' }, reviewer);
    expect(byNumber.map((row) => [row.invoiceId, row.match])).toEqual([
      [flagged.invoiceId, 'exact'],
      [reviewing.invoiceId, 'close'],
    ]);
    const { summary: numbered } = await listReviewQueueBatch(testDb, { view: 'all', q: '26-CR-00418', actorUserAccountId: reviewer }, { limit: 1, after: null });
    expect(numbered?.search).toMatchObject({
      exact: { count: 1, requested: '15.00' },
      close: { count: 1, requested: '50.00', invoices: [expect.objectContaining({ invoiceId: reviewing.invoiceId, caseNumber: '26 cr 418' })] },
      people: 2,
    });
    expect(flagged.invoiceId).toBeTruthy();
  });
});

const byId = (a: { invoiceId: string }, b: { invoiceId: string }) => a.invoiceId.localeCompare(b.invoiceId);
// Each batch counts case numbers among only its own rows' keys, the same totals.
const withoutVolatile = ({ caseNumberMatches: _matches, ...row }: QueueRow) => row;
