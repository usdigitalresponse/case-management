// The portal's invoice list, with deletability and the last submission time
// (recall clears submittedAt).
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseTable, invoice, invoiceApprovalChain, invoiceStatuses, person, professional } from '../db/schema';
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
      // For the submitter's start page, across cases.
      caseClientDisplayName: person.displayName,
      caseExternalReference: caseTable.externalReference,
      professionalDisplayName: professional.displayName,
    })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .where(and(...conditions))
    .orderBy(desc(invoice.submittedAt));
}
