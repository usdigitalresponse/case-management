// Staff review of a submitted invoice — approve or reject. A deliberate
// simplification of model/schema.yaml's invoice_approval_chain/
// invoice_approval_decision (see the comment on those tables in
// ../db/schema.ts): every invoice gets exactly one chain with exactly one
// line_review decision covering the whole invoice, recorded here, with no
// pre-approval step and no per-line granularity.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  invoice,
  invoiceStatuses,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalStepTypes,
  invoiceApprovalOutcomes,
} from '../db/schema';
import { SUBMITTED_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

const LINE_REVIEW_STEP_TYPE_CODE = 'line_review';

export const reviewOutcomeSchema = z.enum(['approved', 'rejected']);
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

export const reviewInvoiceInputSchema = z.object({
  outcome: reviewOutcomeSchema,
  // model/rules.yaml enforce_invoice_approval_sequence: "Require a reason
  // for rejection" — checked below, not by the schema, since whether it's
  // required depends on the outcome.
  reason: z.string().trim().min(1).optional(),
});

export type ReviewInvoiceInput = z.infer<typeof reviewInvoiceInputSchema>;

export class InvoiceNotFoundError extends NotFoundError {
  constructor() {
    super('Invoice not found.');
  }
}

export class InvoiceNotSubmittedError extends ConflictError {
  constructor() {
    super('invalid_state', 'Only a submitted invoice can be reviewed.');
  }
}

export interface ReviewInvoiceResult {
  invoiceId: string;
  statusId: string;
}

export async function reviewInvoice(
  db: Database,
  actorUserAccountId: string,
  invoiceId: string,
  rawInput: unknown,
): Promise<ReviewInvoiceResult> {
  const parsed = reviewInvoiceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  if (input.outcome === 'rejected' && !input.reason) {
    throw new ValidationError({ reason: 'A reason is required to reject an invoice.' });
  }

  // The invoice's new status shares the outcome's code (both seeded as
  // "approved"/"rejected" — see ../db/ensureReferenceData.ts), so it is
  // looked up by that code instead of through a code-to-code mapping.
  const [submittedStatusId, resultStatusId, lineReviewStepTypeId, outcomeId] = await Promise.all([
    getReferenceId(db, invoiceStatuses, SUBMITTED_INVOICE_STATUS_CODE),
    getReferenceId(db, invoiceStatuses, input.outcome),
    getReferenceId(db, invoiceApprovalStepTypes, LINE_REVIEW_STEP_TYPE_CODE),
    getReferenceId(db, invoiceApprovalOutcomes, input.outcome),
  ]);

  return db.transaction(async (tx) => {
    // Conditional on still being submitted, so of two concurrent reviews
    // only one updates a row; the other blocks on the row lock, then
    // matches nothing and is rejected.
    const [updated] = await tx
      .update(invoice)
      .set({ statusId: resultStatusId })
      .where(and(eq(invoice.invoiceId, invoiceId), eq(invoice.statusId, submittedStatusId)))
      .returning({ invoiceId: invoice.invoiceId });
    if (!updated) {
      const [existing] = await tx.select({ invoiceId: invoice.invoiceId }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
      throw existing ? new InvoiceNotSubmittedError() : new InvoiceNotFoundError();
    }

    const chain = firstRow(
      await tx
        .insert(invoiceApprovalChain)
        .values({ invoiceId, createdByUserAccountId: actorUserAccountId, createdAt: new Date() })
        .returning(),
    );
    await tx.insert(invoiceApprovalDecision).values({
      invoiceApprovalChainId: chain.invoiceApprovalChainId,
      sequenceNumber: 1,
      stepTypeId: lineReviewStepTypeId,
      outcomeId,
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: new Date(),
      reason: input.reason,
    });
    return { invoiceId, statusId: resultStatusId };
  });
}
