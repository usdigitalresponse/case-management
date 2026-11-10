// A reviewer sets aside a mileage line's distance warning because the trip
// made stops on the way, or puts it back (model/rules.yaml
// dismiss_mileage_warning). Each change is a new row; the latest stands.
// Staff only, shown to sign-off; the warning itself stays as submitted.
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { expenseTypes, invoice, invoiceApprovalChain, invoiceLine, mileageWarningDismissal, userAccount } from '../db/schema';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { requireReviewPermission } from './reviewAccess';
import { lockInvoiceForReview } from './reviewAssignment';
import { InvoiceLineNotFoundError, InvoiceNotInReviewError } from './reviewInvoiceLine';
import { LINE_REVIEW_STATUS_CODES } from './invoiceStatusCodes';

const inputSchema = z.object({
  dismissed: z.boolean(),
  reason: z.string().trim().max(500, 'Keep it under 500 characters.').optional(),
});

export async function setMileageWarning(db: Database, actorUserAccountId: string, invoiceId: string, invoiceLineId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(invoiceLineId).success) {
    throw new InvoiceLineNotFoundError();
  }
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { dismissed, reason } = parsed.data;
  if (dismissed && !reason) {
    throw new ValidationError({ reason: 'Say what the stops were.' });
  }
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
      throw new InvoiceNotInReviewError();
    }
    // While its lines are still being entered, its trips aren't measured yet.
    const [chain] = await tx
      .select({ snapshot: invoiceApprovalChain.submissionSnapshot, enteredInReview: invoice.enteredInReview })
      .from(invoiceApprovalChain)
      .innerJoin(invoice, eq(invoice.invoiceId, invoiceApprovalChain.invoiceId))
      .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
    if (chain?.enteredInReview && chain.snapshot === null) {
      throw new ConflictError('invalid_state', 'Finish entering the invoice first.');
    }
    const [line] = await tx
      .select({ expenseTypeCode: expenseTypes.code })
      .from(invoiceLine)
      .leftJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
      .where(and(eq(invoiceLine.invoiceLineId, invoiceLineId), eq(invoiceLine.invoiceId, invoiceId)));
    if (!line) {
      throw new InvoiceLineNotFoundError();
    }
    if (line.expenseTypeCode !== 'mileage') {
      throw new ValidationError({ reason: 'Only a mileage line has a distance warning.' });
    }
    await tx.insert(mileageWarningDismissal).values({
      invoiceId,
      invoiceLineId,
      dismissed,
      reason: dismissed ? reason! : null,
      recordedByUserAccountId: actorUserAccountId,
      recordedAt: new Date(),
    });
    return { invoiceId, invoiceLineId, dismissed };
  });
}

export interface MileageWarningDismissal {
  invoiceLineId: string;
  reason: string;
  dismissedByDisplayName: string;
  dismissedAt: Date;
}

// The warnings set aside now, by line.
export async function loadMileageDismissals(db: DatabaseOrTransaction, invoiceId: string): Promise<MileageWarningDismissal[]> {
  const rows = await db
    .select({
      invoiceLineId: mileageWarningDismissal.invoiceLineId,
      dismissed: mileageWarningDismissal.dismissed,
      reason: mileageWarningDismissal.reason,
      dismissedByDisplayName: userAccount.displayName,
      dismissedAt: mileageWarningDismissal.recordedAt,
    })
    .from(mileageWarningDismissal)
    .innerJoin(userAccount, eq(mileageWarningDismissal.recordedByUserAccountId, userAccount.userAccountId))
    .where(eq(mileageWarningDismissal.invoiceId, invoiceId))
    .orderBy(asc(mileageWarningDismissal.recordedAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(row.invoiceLineId, row);
  return [...latest.values()].flatMap((row) =>
    row.dismissed
      ? [{ invoiceLineId: row.invoiceLineId, reason: row.reason ?? '', dismissedByDisplayName: row.dismissedByDisplayName, dismissedAt: row.dismissedAt }]
      : [],
  );
}
