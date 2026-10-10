// Deletes the submitter's draft or withdrawn request if no review decision
// was ever recorded (model/workflows.yaml payment_request delete), with
// everything that hangs off it.
import { z } from 'zod';
import { and, eq, inArray, isNotNull, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  document,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceEvent,
  invoiceImport,
  invoiceLine,
  invoiceStatuses,
  timeEntry,
} from '../db/schema';
import type { DocumentStore } from '../imports/documentStore';
import type { PortalActor } from '../portal/portalActor';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { InvoiceStateError } from './invoiceLifecycle';
import { UNSUBMITTED_INVOICE_STATUS_CODES } from './invoiceStatusCodes';

const reviewStarted = sql`exists (
  select 1 from ${invoiceApprovalDecision}
  join ${invoiceApprovalChain} on ${invoiceApprovalChain.invoiceApprovalChainId} = ${invoiceApprovalDecision.invoiceApprovalChainId}
  where ${invoiceApprovalChain.invoiceId} = ${invoice.invoiceId})`;

// The one deletion rule, for the portal's `deletable` flags and the delete
// itself. Needs `invoice` and `invoiceStatuses` in the query.
export function deletableBy(userAccountId: string): SQL<boolean> {
  return sql<boolean>`(${invoice.submittedByUserAccountId} = ${userAccountId}
    and ${invoiceStatuses.code} in (${sql.join(UNSUBMITTED_INVOICE_STATUS_CODES.map((code) => sql`${code}`), sql`, `)})
    and not ${reviewStarted})`;
}

export async function isInvoiceDeletableBy(db: Database, userAccountId: string, invoiceId: string): Promise<boolean> {
  const [row] = await db
    .select({ deletable: deletableBy(userAccountId) })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  return Boolean(row?.deletable);
}

// Allowed even if the submitter can no longer act for the case.
export async function deleteUnsubmittedInvoice(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  invoiceId: string,
): Promise<{ invoiceId: string }> {
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const files = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        submittedBy: invoice.submittedByUserAccountId,
        statusCode: invoiceStatuses.code,
        reviewStarted: sql<boolean>`${reviewStarted}`,
      })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(eq(invoice.invoiceId, invoiceId))
      .for('update', { of: invoice });
    if (!locked || locked.submittedBy !== actor.userAccountId) {
      throw new InvoiceNotFoundError();
    }
    if (!UNSUBMITTED_INVOICE_STATUS_CODES.includes(locked.statusCode)) {
      throw new InvoiceStateError('Only a draft or withdrawn invoice can be deleted.');
    }
    if (locked.reviewStarted) {
      throw new InvoiceStateError('This invoice has review decisions, so it is kept; withdraw it instead.');
    }

    const imports = await tx
      .select({
        invoiceImportId: invoiceImport.invoiceImportId,
        documentId: invoiceImport.documentId,
        storageReference: document.storageReference,
        contentDeletedAt: document.contentDeletedAt,
      })
      .from(invoiceImport)
      .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
      .where(eq(invoiceImport.invoiceId, invoiceId));
    const importIds = imports.map((row) => row.invoiceImportId);

    await tx.delete(invoiceEvent).where(eq(invoiceEvent.invoiceId, invoiceId));
    await tx.delete(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    if (importIds.length > 0) {
      // Time the import created goes too, unless another invoice uses it.
      const usedElsewhere = tx
        .select({ id: invoiceLine.sourceTimeEntryId })
        .from(invoiceLine)
        .where(and(isNotNull(invoiceLine.sourceTimeEntryId), ne(invoiceLine.invoiceId, invoiceId)));
      await tx
        .update(timeEntry)
        .set({ sourceInvoiceImportId: null })
        .where(and(inArray(timeEntry.sourceInvoiceImportId, importIds), inArray(timeEntry.timeEntryId, usedElsewhere)));
      await tx
        .delete(timeEntry)
        .where(and(inArray(timeEntry.sourceInvoiceImportId, importIds), notInArray(timeEntry.timeEntryId, usedElsewhere)));
      await tx.delete(invoiceImport).where(inArray(invoiceImport.invoiceImportId, importIds));
      await tx.delete(document).where(inArray(document.documentId, imports.map((row) => row.documentId)));
    }
    await tx.delete(invoice).where(eq(invoice.invoiceId, invoiceId));
    return imports.filter((row) => row.contentDeletedAt === null).map((row) => row.storageReference);
  });
  // After commit, so a failed transaction never loses a file still in use.
  for (const storageReference of files) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(storageReference);
  }
  return { invoiceId };
}
