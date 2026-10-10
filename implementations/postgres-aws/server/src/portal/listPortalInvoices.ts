// The portal's invoice list, with deletability and the last submission time
// (recall clears submittedAt).
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { invoice, invoiceApprovalChain, invoiceStatuses } from '../db/schema';
import { portalReadableInvoiceCondition } from '../billing/invoiceAccess';
import type { PortalActor } from './portalActor';
import { deletableBy } from '../billing/deleteInvoice';

export async function listPortalInvoices(db: Database, reader: PortalActor, caseId?: string) {
  const conditions = [portalReadableInvoiceCondition(db, reader)];
  if (caseId) {
    conditions.push(eq(invoice.caseId, caseId));
  }
  return db
    .select({
      invoiceId: invoice.invoiceId,
      caseId: invoice.caseId,
      statusId: invoice.statusId,
      statusCode: invoiceStatuses.code,
      statusDisplayName: invoiceStatuses.displayName,
      submittedAt: invoice.submittedAt,
      submittedTotal: invoice.submittedTotal,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      lastSubmittedAt: sql<Date | null>`(select max(${invoiceApprovalChain.createdAt}) from ${invoiceApprovalChain} where ${invoiceApprovalChain.invoiceId} = ${invoice.invoiceId})`.mapWith(invoiceApprovalChain.createdAt),
      deletable: deletableBy(reader.userAccountId),
    })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(and(...conditions));
}
