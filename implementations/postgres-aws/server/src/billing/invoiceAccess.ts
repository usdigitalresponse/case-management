// Portal read/export access (model/rules.yaml authorize_payment_request_export):
// invoices the user submitted, or that bill their own work as the invoice's
// professional or a line's timekeeper.
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client';
import { invoice, invoiceLine } from '../db/schema';
import { AWAITING_MATCH_INVOICE_STATUS_CODE, UNSUBMITTED_INVOICE_STATUS_CODES } from './invoiceStatusCodes';
import type { PortalActor } from '../portal/portalActor';

// One indexed lookup per way of reading; an OR across them can't use the indexes.
export function portalReadableInvoiceCondition(db: Database, reader: PortalActor): SQL {
  const submitted = db.select({ invoiceId: invoice.invoiceId }).from(invoice).where(eq(invoice.submittedByUserAccountId, reader.userAccountId));
  if (!reader.professionalId) {
    return inArray(invoice.invoiceId, submitted);
  }
  return inArray(
    invoice.invoiceId,
    unionAll(
      submitted,
      db.select({ invoiceId: invoice.invoiceId }).from(invoice).where(eq(invoice.professionalId, reader.professionalId)),
      db.select({ invoiceId: invoiceLine.invoiceId }).from(invoiceLine).where(eq(invoiceLine.timekeeperProfessionalId, reader.professionalId)),
    ),
  );
}

export async function canPortalReaderReadInvoice(
  db: Database,
  reader: PortalActor,
  invoiceId: string,
): Promise<boolean> {
  const rows = await db
    .select({ invoiceId: invoice.invoiceId })
    .from(invoice)
    .where(and(eq(invoice.invoiceId, invoiceId), portalReadableInvoiceCondition(db, reader)));
  return rows.length > 0;
}

// Exports cover requests in or past review, never drafts, withdrawn drafts
// or those still waiting to be matched.
export function isExportableStatus(statusCode: string | null): boolean {
  return statusCode !== null && statusCode !== AWAITING_MATCH_INVOICE_STATUS_CODE && !UNSUBMITTED_INVOICE_STATUS_CODES.includes(statusCode);
}
