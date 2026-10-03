// Staff review of a submitted invoice — approve or reject. A deliberate
// simplification of model/schema.yaml's invoice_approval_chain/
// invoice_approval_decision (see the comment on those tables in
// ../db/schema.ts): every invoice gets exactly one chain with exactly one
// line_review decision covering the whole invoice, recorded here, with no
// pre-approval step and no per-line granularity.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
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

export class ReviewInvoiceValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Invalid invoice review');
    this.name = 'ReviewInvoiceValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class InvoiceNotFoundError extends Error {
  constructor() {
    super('Invoice not found.');
    this.name = 'InvoiceNotFoundError';
  }
}

export class InvoiceNotSubmittedError extends Error {
  constructor() {
    super('Only a submitted invoice can be reviewed.');
    this.name = 'InvoiceNotSubmittedError';
  }
}

export class ReviewInvoiceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewInvoiceConfigurationError';
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
    throw new ReviewInvoiceValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  if (input.outcome === 'rejected' && !input.reason) {
    throw new ReviewInvoiceValidationError({ reason: 'A reason is required to reject an invoice.' });
  }

  const [[invoiceRow], [submittedStatus], [lineReviewStepType], [outcomeRow]] = await Promise.all([
    db.select({ invoiceId: invoice.invoiceId, statusId: invoice.statusId }).from(invoice).where(eq(invoice.invoiceId, invoiceId)),
    db.select().from(invoiceStatuses).where(eq(invoiceStatuses.code, SUBMITTED_INVOICE_STATUS_CODE)),
    db.select().from(invoiceApprovalStepTypes).where(eq(invoiceApprovalStepTypes.code, LINE_REVIEW_STEP_TYPE_CODE)),
    db.select().from(invoiceApprovalOutcomes).where(eq(invoiceApprovalOutcomes.code, input.outcome)),
  ]);
  if (!invoiceRow) {
    throw new InvoiceNotFoundError();
  }
  if (!submittedStatus) {
    throw new ReviewInvoiceConfigurationError(
      `Missing required seeded invoice_statuses row with code "${SUBMITTED_INVOICE_STATUS_CODE}".`,
    );
  }
  if (invoiceRow.statusId !== submittedStatus.id) {
    throw new InvoiceNotSubmittedError();
  }
  if (!lineReviewStepType) {
    throw new ReviewInvoiceConfigurationError(
      `Missing required seeded invoice_approval_step_types row with code "${LINE_REVIEW_STEP_TYPE_CODE}".`,
    );
  }
  if (!outcomeRow) {
    throw new ReviewInvoiceConfigurationError(
      `Missing required seeded invoice_approval_outcomes row with code "${input.outcome}".`,
    );
  }
  // The invoice's new status shares the outcome's code (both seeded as
  // "approved"/"rejected" — see ../db/ensureReferenceData.ts), so one more
  // lookup resolves it instead of a code-to-code mapping table.
  const [resultStatus] = await db.select().from(invoiceStatuses).where(eq(invoiceStatuses.code, input.outcome));
  if (!resultStatus) {
    throw new ReviewInvoiceConfigurationError(`Missing required seeded invoice_statuses row with code "${input.outcome}".`);
  }

  return db.transaction(async (tx) => {
    const chain = firstRow(
      await tx
        .insert(invoiceApprovalChain)
        .values({ invoiceId, createdByUserAccountId: actorUserAccountId, createdAt: new Date() })
        .returning(),
    );
    await tx.insert(invoiceApprovalDecision).values({
      invoiceApprovalChainId: chain.invoiceApprovalChainId,
      sequenceNumber: 1,
      stepTypeId: lineReviewStepType.id,
      outcomeId: outcomeRow.id,
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: new Date(),
      reason: input.reason,
    });
    await tx.update(invoice).set({ statusId: resultStatus.id }).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, statusId: resultStatus.id };
  });
}
