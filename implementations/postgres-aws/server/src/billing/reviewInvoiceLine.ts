// A reviewer's working decision on one line: approve, approve in part or
// reject, changeable until they finish the round (model/rules.yaml
// decide_invoice_lines; ./reviewRounds.ts records it).
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  invoiceApprovalChain,
  invoiceApprovalOutcomes,
  invoiceDecisionReasons,
  invoiceLine,
  invoiceLineTypes,
  invoiceLineWorkingDecision,
  invoiceStatuses,
  invoice,
} from '../db/schema';
import {
  LINE_REVIEW_STATUS_CODES,
  SUBMITTED_INVOICE_STATUS_CODE,
  UNDER_REVIEW_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';
import { fromCents as money, toCents } from './money';
import { recordInvoiceEvent } from './invoiceEvents';
import { claimLineReview, lockInvoiceForReview } from './reviewAssignment';
import { requireReviewPermission } from './reviewAccess';
import { OTHER_REASON_CODE, RATE_REASON_CODE, reasonAppliesTo } from './decisionReasons';
import { loadRateLimits, rateLimitFor } from './preauthorizations';

export const reviewOutcomeSchema = z.enum(['approved', 'approved_in_part', 'rejected']);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

export const reviewInvoiceLineInputSchema = z.object({
  outcome: reviewOutcomeSchema,
  // Approving in part: corrected hours or rate on a line with hours,
  // otherwise the amount.
  approvedQuantity: z.coerce.number().nonnegative().optional(),
  approvedRate: z.coerce.number().nonnegative().optional(),
  approvedAmount: z.coerce.number().positive().optional(),
  reasonCode: z.string().trim().min(1).optional(),
  note: z.string().trim().max(2000).optional(),
});

export class InvoiceNotFoundError extends NotFoundError {
  constructor() {
    super('Invoice not found.');
  }
}

export class InvoiceLineNotFoundError extends NotFoundError {
  constructor() {
    super('Invoice item not found on this invoice.');
  }
}

export class InvoiceNotInReviewError extends ConflictError {
  constructor() {
    super('invalid_state', 'Lines can only be decided while the invoice is being reviewed.');
  }
}

// Locks the invoice, checks it is reviewable by this actor (taking it if
// unassigned) and returns its current chain.
async function beginLineChange(tx: Transaction, actorUserAccountId: string, invoiceId: string) {
  const locked = await lockInvoiceForReview(tx, invoiceId);
  if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
    throw new InvoiceNotInReviewError();
  }
  await claimLineReview(tx, invoiceId, actorUserAccountId);
  // Submission creates the chain; only invoices submitted before that
  // existed get one here, without a snapshot.
  const [existing] = await tx
    .select({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId })
    .from(invoiceApprovalChain)
    .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
  const chainId =
    existing?.invoiceApprovalChainId ??
    firstRow(
      await tx
        .insert(invoiceApprovalChain)
        .values({ invoiceId, createdByUserAccountId: actorUserAccountId, createdAt: new Date() })
        .returning({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId }),
    ).invoiceApprovalChainId;
  return { locked, chainId };
}

// The first decision moves the invoice from waiting to being reviewed, which
// also ends the submitter's chance to recall it.
async function markUnderReview(tx: Transaction, invoiceId: string, statusCode: string, actorUserAccountId: string, chainId: string) {
  if (statusCode !== SUBMITTED_INVOICE_STATUS_CODE) {
    return;
  }
  const statusId = await getReferenceId(tx, invoiceStatuses, UNDER_REVIEW_INVOICE_STATUS_CODE);
  await tx.update(invoice).set({ statusId }).where(eq(invoice.invoiceId, invoiceId));
  await recordInvoiceEvent(tx, { invoiceId, eventTypeCode: 'review_started', statusId, actorUserAccountId, chainId });
}

// An active reason on the list for this outcome.
async function activeReasonId(tx: Transaction, code: string | undefined, outcome: 'approved_in_part' | 'rejected'): Promise<string> {
  const [row] = code
    ? await tx
        .select({ id: invoiceDecisionReasons.id, appliesTo: invoiceDecisionReasons.appliesTo })
        .from(invoiceDecisionReasons)
        .where(and(eq(invoiceDecisionReasons.code, code), eq(invoiceDecisionReasons.active, true)))
    : [];
  if (!row || !reasonAppliesTo(row.appliesTo, outcome)) {
    throw new ValidationError({ reasonCode: 'Choose a reason first.' });
  }
  return row.id;
}

export async function reviewInvoiceLine(
  db: Database,
  actorUserAccountId: string,
  invoiceId: string,
  invoiceLineId: string,
  rawInput: unknown,
) {
  if (!z.uuid().safeParse(invoiceLineId).success) {
    throw new InvoiceLineNotFoundError();
  }
  const parsed = reviewInvoiceLineInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');

  return db.transaction(async (tx) => {
    const { locked, chainId } = await beginLineChange(tx, actorUserAccountId, invoiceId);
    const [line] = await tx
      .select({ amount: invoiceLine.amount, quantity: invoiceLine.quantity, billedRate: invoiceLine.billedRate })
      .from(invoiceLine)
      .where(and(eq(invoiceLine.invoiceLineId, invoiceLineId), eq(invoiceLine.invoiceId, invoiceId)));
    if (!line) {
      throw new InvoiceLineNotFoundError();
    }

    const requestedCents = toCents(line.amount);
    let decision: {
      outcomeCode: 'approved' | 'rejected';
      approvedAmount?: string;
      approvedQuantity?: string;
      approvedRate?: string;
      reasonCodeId?: string;
    };
    if (input.outcome === 'approved') {
      decision = { outcomeCode: 'approved', approvedAmount: money(requestedCents) };
    } else {
      const reasonCodeId = await activeReasonId(tx, input.reasonCode, input.outcome);
      if (input.reasonCode === OTHER_REASON_CODE && !input.note) {
        throw new ValidationError({ note: 'Explain the reason in the note.' });
      }
      if (input.outcome === 'rejected') {
        decision = { outcomeCode: 'rejected', reasonCodeId };
      } else {
        const hasHours = line.quantity !== null && Number(line.quantity) > 0 && line.billedRate !== null;
        let cents: number;
        let approvedQuantity: string | undefined;
        let approvedRate: string | undefined;
        if (hasHours && (input.approvedQuantity !== undefined || input.approvedRate !== undefined)) {
          const quantity = input.approvedQuantity ?? Number(line.quantity);
          const rate = input.approvedRate ?? Number(line.billedRate);
          cents = Math.round(quantity * rate * 100);
          approvedQuantity = String(quantity);
          approvedRate = String(rate);
        } else if (input.approvedAmount !== undefined) {
          cents = toCents(input.approvedAmount);
        } else {
          throw new ValidationError({ approvedAmount: hasHours ? 'Correct the hours or the rate.' : 'Enter the amount to approve.' });
        }
        if (cents <= 0) {
          throw new ValidationError({ approvedAmount: 'Approve more than nothing, or reject the line.' });
        }
        if (cents >= requestedCents) {
          throw new ValidationError({ approvedAmount: `Approve less than the requested ${money(requestedCents)}, or approve the whole line.` });
        }
        decision = { outcomeCode: 'approved', approvedAmount: money(cents), approvedQuantity, approvedRate, reasonCodeId };
      }
    }

    const outcomeId = await getReferenceId(tx, invoiceApprovalOutcomes, decision.outcomeCode);
    const values = {
      outcomeId,
      approvedAmount: decision.approvedAmount ?? null,
      approvedQuantity: decision.approvedQuantity ?? null,
      approvedRate: decision.approvedRate ?? null,
      reasonCodeId: decision.reasonCodeId ?? null,
      note: input.note || null,
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: new Date(),
    };
    await tx
      .insert(invoiceLineWorkingDecision)
      .values({ invoiceApprovalChainId: chainId, invoiceLineId, ...values })
      .onConflictDoUpdate({
        target: [invoiceLineWorkingDecision.invoiceApprovalChainId, invoiceLineWorkingDecision.invoiceLineId],
        set: values,
      });
    await markUnderReview(tx, invoiceId, locked.statusCode, actorUserAccountId, chainId);
    return { invoiceId, invoiceLineId };
  });
}

// Undo: the line is undecided again. Nothing is recorded.
export async function undoLineDecision(db: Database, actorUserAccountId: string, invoiceId: string, invoiceLineId: string) {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const { chainId } = await beginLineChange(tx, actorUserAccountId, invoiceId);
    await tx
      .delete(invoiceLineWorkingDecision)
      .where(
        and(
          eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId),
          eq(invoiceLineWorkingDecision.invoiceLineId, invoiceLineId),
        ),
      );
    return { invoiceId, invoiceLineId };
  });
}

// Approves in part, at the pre-authorized rate (else the configured one),
// every undecided time line billed above it.
export async function repriceLines(db: Database, actorUserAccountId: string, invoiceId: string) {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const { locked, chainId } = await beginLineChange(tx, actorUserAccountId, invoiceId);
    const [header] = await tx
      .select({ caseId: invoice.caseId, professionalId: invoice.professionalId })
      .from(invoice)
      .where(eq(invoice.invoiceId, invoiceId));
    const limits = await loadRateLimits(tx, header!.caseId);
    const rows = await tx
      .select({
        invoiceLineId: invoiceLine.invoiceLineId,
        amount: invoiceLine.amount,
        quantity: invoiceLine.quantity,
        billedRate: invoiceLine.billedRate,
        configuredRate: invoiceLine.configuredRate,
        timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
        decided: invoiceLineWorkingDecision.invoiceLineWorkingDecisionId,
      })
      .from(invoiceLine)
      .innerJoin(invoiceLineTypes, and(eq(invoiceLine.lineTypeId, invoiceLineTypes.id), eq(invoiceLineTypes.code, 'time')))
      .leftJoin(
        invoiceLineWorkingDecision,
        and(
          eq(invoiceLineWorkingDecision.invoiceLineId, invoiceLine.invoiceLineId),
          eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId),
        ),
      )
      .where(eq(invoiceLine.invoiceId, invoiceId));
    const lines = rows.map((line) => ({ ...line, limit: rateLimitFor(line, header!.professionalId, limits)?.rate ?? null }));
    const flagged = lines.filter(
      (line) =>
        !line.decided &&
        line.limit !== null &&
        line.billedRate !== null &&
        line.quantity !== null &&
        Number(line.billedRate) > Number(line.limit),
    );
    if (flagged.length === 0) {
      return { invoiceId, repriced: 0 };
    }
    const [outcomeId, reasonCodeId] = await Promise.all([
      getReferenceId(tx, invoiceApprovalOutcomes, 'approved'),
      activeReasonId(tx, RATE_REASON_CODE, 'approved_in_part'),
    ]);
    const decidedAt = new Date();
    await tx.insert(invoiceLineWorkingDecision).values(
      flagged.map((line) => ({
        invoiceApprovalChainId: chainId,
        invoiceLineId: line.invoiceLineId,
        outcomeId,
        approvedAmount: money(toCents(Number(line.quantity) * Number(line.limit))),
        approvedQuantity: line.quantity,
        approvedRate: line.limit,
        reasonCodeId,
        decidedByUserAccountId: actorUserAccountId,
        decidedAt,
      })),
    );
    await markUnderReview(tx, invoiceId, locked.statusCode, actorUserAccountId, chainId);
    return { invoiceId, repriced: flagged.length };
  });
}
