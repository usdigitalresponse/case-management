// A reviewer corrects a sent invoice's case number (design G15). What the
// sender typed is kept; typing it back clears the correction. Audited.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditEvent, invoice, invoiceStatuses } from '../db/schema';
import { ConflictError, ValidationError } from '../errors';
import { cleanCaseNumber } from './caseNumbers';
import { requireReviewPermission } from './reviewAccess';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { UNSUBMITTED_INVOICE_STATUS_CODES } from './invoiceStatusCodes';

export async function correctCaseNumber(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = z.object({ caseNumber: z.string().max(100, 'Keep the case number under 100 characters.') }).safeParse(rawInput);
  const value = parsed.success ? cleanCaseNumber(parsed.data.caseNumber) : null;
  if (!value || !z.uuid().safeParse(invoiceId).success) {
    throw new ValidationError({ caseNumber: 'Enter the case number.' });
  }
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ typed: invoice.caseNumberAsTyped, corrected: invoice.caseNumberCorrected, statusCode: invoiceStatuses.code })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(eq(invoice.invoiceId, invoiceId))
      .for('update', { of: invoice });
    if (!row) {
      throw new InvoiceNotFoundError();
    }
    if (UNSUBMITTED_INVOICE_STATUS_CODES.includes(row.statusCode)) {
      throw new ConflictError('invalid_state', 'Only a sent invoice’s case number can be corrected.');
    }
    const corrected = value === row.typed ? null : value;
    if (corrected !== row.corrected) {
      await tx.update(invoice).set({ caseNumberCorrected: corrected }).where(eq(invoice.invoiceId, invoiceId));
      await tx.insert(auditEvent).values({
        entityType: 'invoice',
        entityId: invoiceId,
        eventType: 'case_number_corrected',
        actorUserAccountId,
        occurredAt: new Date(),
        priorValues: { caseNumberCorrected: row.corrected },
      });
    }
    return { invoiceId, caseNumberAsTyped: row.typed, caseNumberCorrected: corrected };
  });
}
