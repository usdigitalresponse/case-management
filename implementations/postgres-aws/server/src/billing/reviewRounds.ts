// Finishing a round of line review records it; then each assigned approver
// signs off in turn or sends it back (model/rules.yaml decide_invoice_lines,
// enforce_invoice_approval_sequence; model/workflows.yaml payment_request).
import { z } from 'zod';
import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import { inIds } from '../db/inIds';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, ForbiddenError, ValidationError } from '../errors';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalOutcomes,
  invoiceApprovalStepTypes,
  invoiceDecisionReasons,
  invoiceEvent,
  invoiceEventTypes,
  invoiceLine,
  invoiceLineWorkingDecision,
  invoiceStatuses,
} from '../db/schema';
import { COMMUNICATION_COMPLETED_EVENT_CODE, completionMarkedAt, recordInvoiceEvent } from './invoiceEvents';
import {
  APPROVED_INVOICE_STATUS_CODE,
  AWAITING_ANSWER_INVOICE_STATUS_CODE,
  AWAITING_SIGN_OFF_INVOICE_STATUS_CODE,
  DECIDED_INVOICE_STATUS_CODES,
  REJECTED_INVOICE_STATUS_CODE,
  UNDER_REVIEW_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';
import { canSignOff } from './reviewSettings';
import { LINE_REVIEW_STEP_TYPE_CODE, loadAssignments, lockInvoiceForReview, SIGN_OFF_STEP_TYPE_CODE } from './reviewAssignment';
import { requireReviewPermission } from './reviewAccess';
import { isStaffAccount } from '../portal/portalActor';
import { OTHER_REASON_CODE } from './decisionReasons';
import { fromCents, toCents } from './money';
import { closeEntry, entryIsOpen } from './enterInReview';
import { receiptInputSchema } from './invoiceReceipt';
import { keepsBilledHours, linesBlockedByTimeLog, removeTimeLog } from './reviewTimeLog';
import { fieldErrorsFromZodIssues } from '../intake/validation';

const SECOND_PERSON_MESSAGE = 'At least two people take part in reviewing each invoice.';

export async function currentChainId(db: DatabaseOrTransaction, invoiceId: string): Promise<string | undefined> {
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
  timeLogOverride: string | null;
  decidedByUserAccountId: string;
  decidedAt: Date;
}

function recordedDecisions(db: DatabaseOrTransaction, chainIds: string[]) {
  return db
    .select({
      chainId: invoiceApprovalDecision.invoiceApprovalChainId,
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
      timeLogOverride: invoiceApprovalDecision.timeLogOverride,
      decidedByUserAccountId: invoiceApprovalDecision.decidedByUserAccountId,
      decidedAt: invoiceApprovalDecision.decidedAt,
    })
    .from(invoiceApprovalDecision)
    .innerJoin(invoiceApprovalStepTypes, eq(invoiceApprovalDecision.stepTypeId, invoiceApprovalStepTypes.id))
    .innerJoin(invoiceApprovalOutcomes, eq(invoiceApprovalDecision.outcomeId, invoiceApprovalOutcomes.id))
    .leftJoin(invoiceDecisionReasons, eq(invoiceApprovalDecision.reasonCodeId, invoiceDecisionReasons.id))
    .where(inIds(invoiceApprovalDecision.invoiceApprovalChainId, chainIds))
    .orderBy(asc(invoiceApprovalDecision.sequenceNumber), asc(invoiceApprovalDecision.decidedAt));
}

export async function loadRecordedDecisions(db: DatabaseOrTransaction, chainId: string): Promise<RecordedDecision[]> {
  return (await recordedDecisions(db, [chainId])).map(({ chainId: _chain, ...decision }) => decision);
}

// The same for several chains, by chain.
export async function loadRecordedDecisionsByChain(db: DatabaseOrTransaction, chainIds: string[]): Promise<Map<string, RecordedDecision[]>> {
  const byChain = new Map<string, RecordedDecision[]>();
  for (const { chainId, ...decision } of chainIds.length === 0 ? [] : await recordedDecisions(db, chainIds)) {
    byChain.set(chainId, [...(byChain.get(chainId) ?? []), decision]);
  }
  return byChain;
}

// Also in SQL (./queueSql.ts latestRound); change both together.
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

// Also in SQL (./queueSql.ts approvedTotalOf); change both together.
// What the latest finished round approved; null until a round is finished,
// nothing once the invoice was rejected at sign-off.
export function approvedTotal(decisions: RecordedDecision[], round: number | null): string | null {
  if (round === null) return null;
  if (decisions.some((decision) => decision.stepCode === SIGN_OFF_STEP_TYPE_CODE && decision.sequenceNumber > round && decision.outcomeCode === 'rejected')) {
    return fromCents(0);
  }
  const cents = decisions
    .filter((decision) => decision.sequenceNumber === round && decision.invoiceLineId)
    .reduce((sum, decision) => sum + toCents(decision.approvedAmount), 0);
  return fromCents(cents);
}

// Also in SQL (./queueSql.ts holderOf); change both together.
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

export async function setStatus(
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
      timeLogOverride: invoiceApprovalDecision.timeLogOverride,
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

// Finishing the first round of an invoice entered in review also freezes
// it, with how it was received (rawReceipt).
export async function finishReview(db: Database, actorUserAccountId: string, invoiceId: string, rawReceipt: unknown = {}) {
  const receipt = receiptInputSchema.safeParse(rawReceipt ?? {});
  if (!receipt.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(receipt.error.issues));
  }
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (locked.statusCode === AWAITING_ANSWER_INVOICE_STATUS_CODE) {
      throw new ConflictError('invalid_state', 'Review is waiting for an answer to a question.');
    }
    if (locked.statusCode !== UNDER_REVIEW_INVOICE_STATUS_CODE) {
      throw new ConflictError('invalid_state', 'Decide every line before finishing the review.');
    }
    const assignments = await loadAssignments(tx, invoiceId);
    if (assignments.signOff.length === 0) {
      throw new ValidationError({ signOff: 'Choose who signs off before finishing the review.' });
    }
    const chainId = (await currentChainId(tx, invoiceId)) as string;
    if (await entryIsOpen(tx, invoiceId)) {
      await closeEntry(tx, actorUserAccountId, invoiceId, chainId, receipt.data);
    }
    const [lines, working, otherReasonId] = await Promise.all([
      tx.select({ invoiceLineId: invoiceLine.invoiceLineId, quantity: invoiceLine.quantity }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)),
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
    // Approved before the log was uploaded, or before a line changed.
    const approvedId = await getReferenceId(tx, invoiceApprovalOutcomes, 'approved');
    const billed = new Map(lines.map((line) => [line.invoiceLineId, line.quantity]));
    const blocked = await linesBlockedByTimeLog(
      tx,
      invoiceId,
      working
        .filter(
          (decision) =>
            !decision.timeLogOverride &&
            keepsBilledHours({ approved: decision.outcomeId === approvedId, ...decision }, billed.get(decision.invoiceLineId) ?? null),
        )
        .map((decision) => decision.invoiceLineId),
    );
    if (blocked.size > 0) {
      throw new ValidationError({
        lines: `${blocked.size} approved ${blocked.size === 1 ? "line isn't" : "lines aren't"} supported by the time log as billed. Decide ${blocked.size === 1 ? 'it' : 'them'} again.`,
      });
    }
    const takingPart = new Set([actorUserAccountId, ...working.map((decision) => decision.decidedByUserAccountId), ...assignments.signOff.map((person) => person.userAccountId)]);
    if (takingPart.size < 2) {
      throw new ValidationError({ signOff: `${SECOND_PERSON_MESSAGE} Choose someone else to sign off.` });
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
        // Each line keeps who decided it; the review_finished event records who finished.
        decidedByUserAccountId: decision.decidedByUserAccountId,
        decidedAt: decision.decidedAt,
        reason: decision.note,
        reasonCodeId: decision.reasonCodeId,
        approvedAmount: decision.approvedAmount,
        approvedQuantity: decision.approvedQuantity,
        approvedRate: decision.approvedRate,
        timeLogOverride: decision.timeLogOverride,
      })),
    );
    await tx.delete(invoiceLineWorkingDecision).where(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId));
    await removeTimeLog(tx, invoiceId);
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

// Who decided the latest round's lines, who finished it and who has signed off since.
async function roundParticipants(tx: Transaction, invoiceId: string, decisions: RecordedDecision[], round: number | null): Promise<Set<string>> {
  const people = new Set(
    decisions
      .filter(
        (decision) =>
          round !== null &&
          (decision.sequenceNumber === round ||
            (decision.stepCode === SIGN_OFF_STEP_TYPE_CODE && decision.sequenceNumber > round && decision.outcomeCode === 'approved')),
      )
      .map((decision) => decision.decidedByUserAccountId),
  );
  const [finished] = await tx
    .select({ actorUserAccountId: invoiceEvent.actorUserAccountId })
    .from(invoiceEvent)
    .innerJoin(invoiceEventTypes, eq(invoiceEventTypes.id, invoiceEvent.eventTypeId))
    .where(and(eq(invoiceEvent.invoiceId, invoiceId), eq(invoiceEventTypes.code, 'review_finished')))
    .orderBy(desc(invoiceEvent.sequenceNumber))
    .limit(1);
  if (finished?.actorUserAccountId) people.add(finished.actorUserAccountId);
  return people;
}

const signOffInputSchema = z.object({
  outcome: z.enum(['approved', 'rejected', 'changes_requested']),
  comment: z.string().trim().max(2000).optional(),
});

// The next approver signs off, sends it back, or rejects the whole invoice.
export async function signOffInvoice(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = signOffInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ outcome: 'Sign off, reject or send it back.' });
  }
  const input = parsed.data;
  if (input.outcome === 'changes_requested' && !input.comment) {
    throw new ValidationError({ comment: 'Say what the reviewer should change.' });
  }
  if (!(await canSignOff(db, actorUserAccountId))) {
    throw new ForbiddenError('forbidden', 'Only sign-off approvers named in Settings can sign off invoices.');
  }
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
    const last = signOff.at(-1)?.userAccountId === actorUserAccountId;
    const decides = input.outcome === 'rejected' || (input.outcome === 'approved' && last);
    if (decides && (await roundParticipants(tx, invoiceId, decisions, round)).add(actorUserAccountId).size < 2) {
      throw new ConflictError('second_person_needed', `${SECOND_PERSON_MESSAGE} Someone else needs to sign off.`);
    }
    await tx.insert(invoiceApprovalDecision).values({
      invoiceApprovalChainId: chainId,
      sequenceNumber: await nextSequenceNumber(tx, chainId),
      stepTypeId: await getReferenceId(tx, invoiceApprovalStepTypes, SIGN_OFF_STEP_TYPE_CODE),
      outcomeId: await getReferenceId(tx, invoiceApprovalOutcomes, input.outcome),
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: new Date(),
      reason: input.comment || null,
      // A send-back is for the reviewer; approving or rejecting the whole
      // invoice is shared like line notes (limit_review_comment_visibility).
      internalOnly: input.outcome === 'changes_requested' && Boolean(input.comment),
    });
    if (input.outcome === 'changes_requested') {
      await seedWorkingFromRound(tx, chainId, round as number);
      await setStatus(tx, invoiceId, UNDER_REVIEW_INVOICE_STATUS_CODE, { eventTypeCode: 'sent_back', actorUserAccountId, chainId });
      return { invoiceId, statusCode: UNDER_REVIEW_INVOICE_STATUS_CODE };
    }
    if (input.outcome === 'rejected') {
      await setStatus(tx, invoiceId, REJECTED_INVOICE_STATUS_CODE, { eventTypeCode: 'rejected', actorUserAccountId, chainId });
      return { invoiceId, statusCode: REJECTED_INVOICE_STATUS_CODE };
    }
    if (last) {
      await setStatus(tx, invoiceId, APPROVED_INVOICE_STATUS_CODE, { eventTypeCode: 'approved', actorUserAccountId, chainId });
      return { invoiceId, statusCode: APPROVED_INVOICE_STATUS_CODE };
    }
    await setStatus(tx, invoiceId, AWAITING_SIGN_OFF_INVOICE_STATUS_CODE, { eventTypeCode: 'signed_off', actorUserAccountId, chainId });
    return { invoiceId, statusCode: AWAITING_SIGN_OFF_INVOICE_STATUS_CODE };
  });
}

// Staff have finished telling the sender the decision; the status is unchanged.
export async function markCompleted(db: Database, actorUserAccountId: string, invoiceId: string) {
  if (!(await isStaffAccount(db, actorUserAccountId))) {
    throw new ForbiddenError('forbidden', 'Only staff can mark an invoice completed.');
  }
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (!DECIDED_INVOICE_STATUS_CODES.includes(locked.statusCode)) {
      throw new ConflictError('invalid_state', 'Only a decided invoice can be marked completed.');
    }
    const [current] = await tx.select({ at: completionMarkedAt }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
    if (current?.at) {
      return { invoiceId, completedAt: current.at };
    }
    const occurredAt = await recordInvoiceEvent(tx, {
      invoiceId,
      eventTypeCode: COMMUNICATION_COMPLETED_EVENT_CODE,
      statusId: locked.statusId,
      actorUserAccountId,
      chainId: await currentChainId(tx, invoiceId),
    });
    return { invoiceId, completedAt: occurredAt };
  });
}
