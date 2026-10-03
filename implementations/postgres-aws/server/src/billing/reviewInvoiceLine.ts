// Approves (up to the requested amount) or rejects one line of a submitted
// invoice. Once every line is decided, the invoice becomes approved, or
// rejected if any line was (model/rules.yaml: a rejection "blocks advancement").
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  invoice,
  invoiceLine,
  invoiceStatuses,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalStepTypes,
  invoiceApprovalOutcomes,
} from '../db/schema';
import { APPROVED_INVOICE_STATUS_CODE, SUBMITTED_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

const LINE_REVIEW_STEP_TYPE_CODE = 'line_review';
const LINE_REVIEW_SEQUENCE_NUMBER = 1;

export const reviewOutcomeSchema = z.enum(['approved', 'rejected']);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

export const reviewInvoiceLineInputSchema = z.object({
  outcome: reviewOutcomeSchema,
  // Approval only; defaults to the line amount.
  approvedAmount: z.coerce.number().positive().optional(),
  // Required to reject; checked below.
  reason: z.string().trim().min(1).optional(),
});

export type ReviewInvoiceLineInput = z.infer<typeof reviewInvoiceLineInputSchema>;

export class InvoiceNotFoundError extends NotFoundError {
  constructor() {
    super('Invoice not found.');
  }
}

export class InvoiceLineNotFoundError extends NotFoundError {
  constructor() {
    super('Invoice line not found on this invoice.');
  }
}

export class InvoiceNotSubmittedError extends ConflictError {
  constructor() {
    super('invalid_state', 'Only a submitted invoice can be reviewed.');
  }
}

export class InvoiceLineAlreadyReviewedError extends ConflictError {
  constructor() {
    super('already_reviewed', 'This invoice line has already been reviewed.');
  }
}

export interface ReviewInvoiceLineResult {
  invoiceId: string;
  invoiceLineId: string;
  // Stays submitted until every line is decided.
  statusId: string;
}

function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

export async function reviewInvoiceLine(
  db: Database,
  actorUserAccountId: string,
  invoiceId: string,
  invoiceLineId: string,
  rawInput: unknown,
): Promise<ReviewInvoiceLineResult> {
  // A malformed path id can't match a row.
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  if (!z.uuid().safeParse(invoiceLineId).success) {
    throw new InvoiceLineNotFoundError();
  }

  const parsed = reviewInvoiceLineInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  if (input.outcome === 'rejected') {
    if (!input.reason) {
      throw new ValidationError({ reason: 'A reason is required to reject an invoice line.' });
    }
    if (input.approvedAmount !== undefined) {
      throw new ValidationError({ approvedAmount: 'A rejected line has no approved amount.' });
    }
  }

  const [submittedStatusId, approvedStatusId, rejectedStatusId, lineReviewStepTypeId, approvedOutcomeId, rejectedOutcomeId] =
    await Promise.all([
      getReferenceId(db, invoiceStatuses, SUBMITTED_INVOICE_STATUS_CODE),
      getReferenceId(db, invoiceStatuses, APPROVED_INVOICE_STATUS_CODE),
      getReferenceId(db, invoiceStatuses, 'rejected'),
      getReferenceId(db, invoiceApprovalStepTypes, LINE_REVIEW_STEP_TYPE_CODE),
      getReferenceId(db, invoiceApprovalOutcomes, 'approved'),
      getReferenceId(db, invoiceApprovalOutcomes, 'rejected'),
    ]);

  return db.transaction(async (tx) => {
    // Serializes decisions on this invoice so chain creation and the
    // completion check can't race.
    const [locked] = await tx
      .select({ statusId: invoice.statusId })
      .from(invoice)
      .where(eq(invoice.invoiceId, invoiceId))
      .for('update');
    if (!locked) {
      throw new InvoiceNotFoundError();
    }
    if (locked.statusId !== submittedStatusId) {
      throw new InvoiceNotSubmittedError();
    }

    const [line] = await tx
      .select({ amount: invoiceLine.amount })
      .from(invoiceLine)
      .where(and(eq(invoiceLine.invoiceLineId, invoiceLineId), eq(invoiceLine.invoiceId, invoiceId)));
    if (!line) {
      throw new InvoiceLineNotFoundError();
    }

    let approvedAmount: string | undefined;
    if (input.outcome === 'approved') {
      const approvedCents = toCents(input.approvedAmount ?? line.amount);
      if (approvedCents > toCents(line.amount)) {
        throw new ValidationError({ approvedAmount: `Cannot approve more than the requested ${line.amount}.` });
      }
      if (approvedCents <= 0) {
        throw new ValidationError({ approvedAmount: 'Approved amount must be at least 0.01.' });
      }
      approvedAmount = (approvedCents / 100).toFixed(2);
    }

    const [existingChain] = await tx
      .select({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId })
      .from(invoiceApprovalChain)
      .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
    const chainId =
      existingChain?.invoiceApprovalChainId ??
      firstRow(
        await tx
          .insert(invoiceApprovalChain)
          .values({ invoiceId, createdByUserAccountId: actorUserAccountId, createdAt: new Date() })
          .returning({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId }),
      ).invoiceApprovalChainId;

    const [existingDecision] = await tx
      .select({ id: invoiceApprovalDecision.invoiceApprovalDecisionId })
      .from(invoiceApprovalDecision)
      .where(
        and(
          eq(invoiceApprovalDecision.invoiceApprovalChainId, chainId),
          eq(invoiceApprovalDecision.sequenceNumber, LINE_REVIEW_SEQUENCE_NUMBER),
          eq(invoiceApprovalDecision.invoiceLineId, invoiceLineId),
        ),
      );
    if (existingDecision) {
      throw new InvoiceLineAlreadyReviewedError();
    }

    await tx.insert(invoiceApprovalDecision).values({
      invoiceApprovalChainId: chainId,
      sequenceNumber: LINE_REVIEW_SEQUENCE_NUMBER,
      stepTypeId: lineReviewStepTypeId,
      invoiceLineId,
      outcomeId: input.outcome === 'approved' ? approvedOutcomeId : rejectedOutcomeId,
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: new Date(),
      reason: input.reason,
      approvedAmount,
    });

    const [lines, decisions] = await Promise.all([
      tx.select({ invoiceLineId: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)),
      tx
        .select({ invoiceLineId: invoiceApprovalDecision.invoiceLineId, outcomeId: invoiceApprovalDecision.outcomeId })
        .from(invoiceApprovalDecision)
        .where(
          and(
            eq(invoiceApprovalDecision.invoiceApprovalChainId, chainId),
            eq(invoiceApprovalDecision.sequenceNumber, LINE_REVIEW_SEQUENCE_NUMBER),
          ),
        ),
    ]);
    const decidedLineIds = new Set(decisions.map((decision) => decision.invoiceLineId));
    if (!lines.every((l) => decidedLineIds.has(l.invoiceLineId))) {
      return { invoiceId, invoiceLineId, statusId: submittedStatusId };
    }

    const statusId = decisions.some((decision) => decision.outcomeId === rejectedOutcomeId)
      ? rejectedStatusId
      : approvedStatusId;
    await tx.update(invoice).set({ statusId }).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, invoiceLineId, statusId };
  });
}
