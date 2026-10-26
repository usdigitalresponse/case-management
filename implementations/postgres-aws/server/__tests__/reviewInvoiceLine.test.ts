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
import { finishReview, reopenReview, signOffInvoice } from '../src/billing/reviewRounds';
import { NotYourInvoiceError, reassignReviewer, setSignOffApprovers } from '../src/billing/reviewAssignment';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
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

type LineSpec = string | { amount: string; quantity: string; billedRate: string; configuredRate?: string };

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

  it('only lets reviewers decide, and only the assigned one', async () => {
    const { invoiceId, lineIds } = await createInvoiceWithLines(['70.00']);
    await expect(reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lineIds[0]!, { outcome: 'approved' })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(reviewInvoiceLine(testDb, approver, invoiceId, lineIds[0]!, { outcome: 'approved' })).rejects.toThrow(ForbiddenError);

    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    const other = await createStaff('reviewer');
    await expect(reviewInvoiceLine(testDb, other, invoiceId, lineIds[0]!, { outcome: 'approved' })).rejects.toThrow(NotYourInvoiceError);

    // Any reviewer may give it to themselves, keeping the decisions made.
    await reassignReviewer(testDb, other, invoiceId, { userAccountId: other });
    await reviewInvoiceLine(testDb, other, invoiceId, lineIds[0]!, { outcome: 'rejected', reasonCode: 'duplicate' });
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
        caseId: row!.caseId,
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
    expect(await loadPreauthorizationSummaries(testDb, row!.caseId)).toEqual([
      expect.objectContaining({ ceiling: '150.00', approvedSoFar: '50.00', waiting: '30.00' }),
    ]);
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

    // The next round needs both sign-offs again.
    await finishReview(testDb, reviewer, invoiceId);
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'approved' });
    await signOffInvoice(testDb, second, invoiceId, { outcome: 'approved' });
    expect(await statusCode(invoiceId)).toBe('approved');
  });
});
