// Finishing a round of line review records it; then each assigned approver
// signs off in turn or sends it back (model/rules.yaml decide_invoice_lines,
// enforce_invoice_approval_sequence; model/workflows.yaml payment_request).
import { z } from 'zod';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, ValidationError } from '../errors';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalOutcomes,
  invoiceApprovalStepTypes,
  invoiceDecisionReasons,
  invoiceLine,
  invoiceLineWorkingDecision,
  invoiceStatuses,
} from '../db/schema';
import { recordInvoiceEvent } from './invoiceEvents';
import {
  APPROVED_INVOICE_STATUS_CODE,
  AWAITING_SIGN_OFF_INVOICE_STATUS_CODE,
  UNDER_REVIEW_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';
import { LINE_REVIEW_STEP_TYPE_CODE, loadAssignments, lockInvoiceForReview, SIGN_OFF_STEP_TYPE_CODE } from './reviewAssignment';
import { requireReviewPermission } from './reviewAccess';
import { OTHER_REASON_CODE } from './decisionReasons';
import { fromCents, toCents } from './money';

async function currentChainId(db: DatabaseOrTransaction, invoiceId: string): Promise<string | undefined> {
  const [chain] = await db
    .select({ id: invoiceApprovalChain.invoiceApprovalChainId })
    .from(invoiceApprovalChain)
    .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
  return chain?.id;
}

export interface RecordedDecision {
  sequenceNumber: number;
  stepCode: string;
  invoiceLineId: string | null;
  outcomeCode: string;
  approvedAmount: string | null;
  approvedQuantity: string | null;
  approvedRate: string | null;
  reasonCode: string | null;
  reasonDisplayName: string | null;
  reason: string | null;
  internalOnly: boolean;
  decidedByUserAccountId: string;
  decidedAt: Date;
}

export async function loadRecordedDecisions(db: DatabaseOrTransaction, chainId: string): Promise<RecordedDecision[]> {
  return db
    .select({
      sequenceNumber: invoiceApprovalDecision.sequenceNumber,
      stepCode: invoiceApprovalStepTypes.code,
      invoiceLineId: invoiceApprovalDecision.invoiceLineId,
      outcomeCode: invoiceApprovalOutcomes.code,
      approvedAmount: invoiceApprovalDecision.approvedAmount,
      approvedQuantity: invoiceApprovalDecision.approvedQuantity,
      approvedRate: invoiceApprovalDecision.approvedRate,
      reasonCode: invoiceDecisionReasons.code,
      reasonDisplayName: invoiceDecisionReasons.displayName,
      reason: invoiceApprovalDecision.reason,
      internalOnly: invoiceApprovalDecision.internalOnly,
      decidedByUserAccountId: invoiceApprovalDecision.decidedByUserAccountId,
      decidedAt: invoiceApprovalDecision.decidedAt,
    })
    .from(invoiceApprovalDecision)
    .innerJoin(invoiceApprovalStepTypes, eq(invoiceApprovalDecision.stepTypeId, invoiceApprovalStepTypes.id))
    .innerJoin(invoiceApprovalOutcomes, eq(invoiceApprovalDecision.outcomeId, invoiceApprovalOutcomes.id))
    .leftJoin(invoiceDecisionReasons, eq(invoiceApprovalDecision.reasonCodeId, invoiceDecisionReasons.id))
    .where(eq(invoiceApprovalDecision.invoiceApprovalChainId, chainId))
    .orderBy(asc(invoiceApprovalDecision.sequenceNumber), asc(invoiceApprovalDecision.decidedAt));
}

// The latest sequence number at which every line was decided. An
// incomplete round (from before rounds existed) doesn't count.
export function latestRoundNumber(decisions: RecordedDecision[], lineCount: number): number | null {
  const linesBySequence = new Map<number, number>();
  for (const decision of decisions) {
    if (decision.stepCode === LINE_REVIEW_STEP_TYPE_CODE) {
      linesBySequence.set(decision.sequenceNumber, (linesBySequence.get(decision.sequenceNumber) ?? 0) + 1);
    }
  }
  const complete = [...linesBySequence.entries()].filter(([, count]) => count >= lineCount && lineCount > 0);
  return complete.length === 0 ? null : Math.max(...complete.map(([sequence]) => sequence));
}

// What the latest finished round approved; null until a round is finished.
export function approvedTotal(decisions: RecordedDecision[], round: number | null): string | null {
  if (round === null) return null;
  const cents = decisions
    .filter((decision) => decision.sequenceNumber === round && decision.invoiceLineId)
    .reduce((sum, decision) => sum + toCents(decision.approvedAmount), 0);
  return fromCents(cents);
}

// Sign-off after the latest round: who signs next, in order, and whether
// anyone has signed yet.
export function signOffProgress<T extends { userAccountId: string }>(
  decisions: RecordedDecision[],
  round: number | null,
  approvers: T[],
): { next: T | null; started: boolean } {
  const since = decisions.filter(
    (decision) => decision.stepCode === SIGN_OFF_STEP_TYPE_CODE && round !== null && decision.sequenceNumber > round,
  );
  const signed = new Set(since.filter((decision) => decision.outcomeCode === 'approved').map((decision) => decision.decidedByUserAccountId));
  return { next: approvers.find((approver) => !signed.has(approver.userAccountId)) ?? null, started: since.length > 0 };
}

async function nextSequenceNumber(tx: Transaction, chainId: string): Promise<number> {
  const [row] = await tx
    .select({ last: max(invoiceApprovalDecision.sequenceNumber) })
    .from(invoiceApprovalDecision)
    .where(eq(invoiceApprovalDecision.invoiceApprovalChainId, chainId));
  return (row?.last ?? 0) + 1;
}

async function setStatus(
  tx: Transaction,
  invoiceId: string,
  code: string,
  event: { eventTypeCode: string; actorUserAccountId: string; chainId: string },
) {
  const statusId = await getReferenceId(tx, invoiceStatuses, code);
  await tx.update(invoice).set({ statusId }).where(eq(invoice.invoiceId, invoiceId));
  await recordInvoiceEvent(tx, { invoiceId, statusId, ...event });
}

// Copies a recorded round back into working decisions, for reopening or a
// send-back.
async function seedWorkingFromRound(tx: Transaction, chainId: string, round: number) {
  await tx.delete(invoiceLineWorkingDecision).where(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId));
  const rows = await tx
    .select({
      invoiceLineId: invoiceApprovalDecision.invoiceLineId,
      outcomeId: invoiceApprovalDecision.outcomeId,
      approvedAmount: invoiceApprovalDecision.approvedAmount,
      approvedQuantity: invoiceApprovalDecision.approvedQuantity,
      approvedRate: invoiceApprovalDecision.approvedRate,
      reasonCodeId: invoiceApprovalDecision.reasonCodeId,
      note: invoiceApprovalDecision.reason,
      decidedByUserAccountId: invoiceApprovalDecision.decidedByUserAccountId,
      decidedAt: invoiceApprovalDecision.decidedAt,
    })
    .from(invoiceApprovalDecision)
    .where(and(eq(invoiceApprovalDecision.invoiceApprovalChainId, chainId), eq(invoiceApprovalDecision.sequenceNumber, round)));
  if (rows.length > 0) {
    await tx.insert(invoiceLineWorkingDecision).values(
      rows.map((row) => ({ ...row, invoiceLineId: row.invoiceLineId as string, invoiceApprovalChainId: chainId })),
    );
  }
}

export async function finishReview(db: Database, actorUserAccountId: string, invoiceId: string) {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (locked.statusCode !== UNDER_REVIEW_INVOICE_STATUS_CODE) {
      throw new ConflictError('invalid_state', 'Decide every line before finishing the review.');
    }
    const assignments = await loadAssignments(tx, invoiceId);
    if (assignments.reviewer?.userAccountId !== actorUserAccountId) {
      throw new ConflictError('not_assigned', "Only the invoice's reviewer can finish the review.");
    }
    if (assignments.signOff.length === 0) {
      throw new ValidationError({ signOff: 'Choose who signs off before finishing the review.' });
    }
    const chainId = (await currentChainId(tx, invoiceId)) as string;
    const [lines, working, otherReasonId] = await Promise.all([
      tx.select({ invoiceLineId: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)),
      tx.select().from(invoiceLineWorkingDecision).where(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId)),
      getReferenceId(tx, invoiceDecisionReasons, OTHER_REASON_CODE),
    ]);
    const undecided = lines.filter((line) => !working.some((decision) => decision.invoiceLineId === line.invoiceLineId));
    if (undecided.length > 0) {
      throw new ValidationError({
        lines: `${undecided.length} ${undecided.length === 1 ? 'line has' : 'lines have'} no decision yet.`,
      });
    }
    // Converted from before reasons existed: a rejection may lack one.
    if (working.some((decision) => decision.reasonCodeId === otherReasonId && !decision.note)) {
      throw new ValidationError({ lines: 'A line decided for another reason needs a note.' });
    }
    const sequenceNumber = await nextSequenceNumber(tx, chainId);
    const stepTypeId = await getReferenceId(tx, invoiceApprovalStepTypes, LINE_REVIEW_STEP_TYPE_CODE);
    await tx.insert(invoiceApprovalDecision).values(
      working.map((decision) => ({
        invoiceApprovalChainId: chainId,
        sequenceNumber,
        stepTypeId,
        invoiceLineId: decision.invoiceLineId,
        outcomeId: decision.outcomeId,
        // Finishing is the decision; the reviewer is the one who finishes.
        decidedByUserAccountId: actorUserAccountId,
        decidedAt: new Date(),
        reason: decision.note,
        reasonCodeId: decision.reasonCodeId,
        approvedAmount: decision.approvedAmount,
        approvedQuantity: decision.approvedQuantity,
        approvedRate: decision.approvedRate,
      })),
    );
    await tx.delete(invoiceLineWorkingDecision).where(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId));
    await setStatus(tx, invoiceId, AWAITING_SIGN_OFF_INVOICE_STATUS_CODE, {
      eventTypeCode: 'review_finished',
      actorUserAccountId,
      chainId,
    });
    return { invoiceId, round: sequenceNumber };
  });
}

async function loadRoundState(tx: Transaction, invoiceId: string, chainId: string) {
  const [decisions, lines] = await Promise.all([
    loadRecordedDecisions(tx, chainId),
    tx.select({ invoiceLineId: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)),
  ]);
  const round = latestRoundNumber(decisions, lines.length);
  const signOffs = decisions.filter(
    (decision) => decision.stepCode === SIGN_OFF_STEP_TYPE_CODE && round !== null && decision.sequenceNumber > round,
  );
  return { decisions, round, signOffs };
}

// Undo straight after finishing, or reopen any time before the first
// sign-off. The finished round stays recorded.
export async function reopenReview(db: Database, actorUserAccountId: string, invoiceId: string) {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (locked.statusCode !== AWAITING_SIGN_OFF_INVOICE_STATUS_CODE) {
      throw new ConflictError('invalid_state', 'Only a finished review waiting for sign-off can be reopened.');
    }
    const { reviewer } = await loadAssignments(tx, invoiceId);
    if (reviewer?.userAccountId !== actorUserAccountId) {
      throw new ConflictError('not_assigned', "Only the invoice's reviewer can reopen the review.");
    }
    const chainId = (await currentChainId(tx, invoiceId)) as string;
    const { round, signOffs } = await loadRoundState(tx, invoiceId, chainId);
    if (signOffs.length > 0 || round === null) {
      throw new ConflictError('invalid_state', 'Sign-off has started, so the review can no longer be reopened.');
    }
    await seedWorkingFromRound(tx, chainId, round);
    await setStatus(tx, invoiceId, UNDER_REVIEW_INVOICE_STATUS_CODE, {
      eventTypeCode: 'review_reopened',
      actorUserAccountId,
      chainId,
    });
    return { invoiceId };
  });
}

const signOffInputSchema = z.object({
  outcome: z.enum(['approved', 'changes_requested']),
  comment: z.string().trim().max(2000).optional(),
});

export async function signOffInvoice(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = signOffInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ outcome: 'Sign off or send it back.' });
  }
  const input = parsed.data;
  if (input.outcome === 'changes_requested' && !input.comment) {
    throw new ValidationError({ comment: 'Say what the reviewer should change.' });
  }
  await requireReviewPermission(db, actorUserAccountId, 'signOff');
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (locked.statusCode !== AWAITING_SIGN_OFF_INVOICE_STATUS_CODE) {
      throw new ConflictError('invalid_state', 'This invoice is not waiting for sign-off.');
    }
    const chainId = (await currentChainId(tx, invoiceId)) as string;
    const { decisions, round } = await loadRoundState(tx, invoiceId, chainId);
    const { signOff } = await loadAssignments(tx, invoiceId);
    const { next } = signOffProgress(decisions, round, signOff);
    if (!next || next.userAccountId !== actorUserAccountId) {
      throw new ConflictError(
        'not_assigned',
        next ? `${next.displayName} signs off next.` : 'Everyone assigned has already signed off.',
      );
    }
    await tx.insert(invoiceApprovalDecision).values({
      invoiceApprovalChainId: chainId,
      sequenceNumber: await nextSequenceNumber(tx, chainId),
      stepTypeId: await getReferenceId(tx, invoiceApprovalStepTypes, SIGN_OFF_STEP_TYPE_CODE),
      outcomeId: await getReferenceId(tx, invoiceApprovalOutcomes, input.outcome),
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: new Date(),
      reason: input.comment || null,
      // Sign-off comments are for staff (limit_review_comment_visibility).
      internalOnly: Boolean(input.comment),
    });
    if (input.outcome === 'changes_requested') {
      await seedWorkingFromRound(tx, chainId, round as number);
      await setStatus(tx, invoiceId, UNDER_REVIEW_INVOICE_STATUS_CODE, { eventTypeCode: 'sent_back', actorUserAccountId, chainId });
      return { invoiceId, statusCode: UNDER_REVIEW_INVOICE_STATUS_CODE };
    }
    const last = signOff.at(-1)?.userAccountId === actorUserAccountId;
    if (last) {
      await setStatus(tx, invoiceId, APPROVED_INVOICE_STATUS_CODE, { eventTypeCode: 'approved', actorUserAccountId, chainId });
      return { invoiceId, statusCode: APPROVED_INVOICE_STATUS_CODE };
    }
    await setStatus(tx, invoiceId, AWAITING_SIGN_OFF_INVOICE_STATUS_CODE, { eventTypeCode: 'signed_off', actorUserAccountId, chainId });
    return { invoiceId, statusCode: AWAITING_SIGN_OFF_INVOICE_STATUS_CODE };
  });
}
