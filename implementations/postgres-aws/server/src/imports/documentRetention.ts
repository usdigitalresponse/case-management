// How long an uploaded file is kept: while any import of it is still being
// checked, or its confirmed request is still live (not withdrawn), so the
// submitter and reviewers can see it beside the lines. A request's file goes
// when the request is withdrawn or deleted. Payment completion isn't recorded
// yet, so a live request's file stays until then (see ../../MAPPING.md).
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { document, invoice, invoiceImport, invoiceImportStatuses, invoiceStatuses } from '../db/schema';
import { WITHDRAWN_INVOICE_STATUS_CODE } from '../billing/invoiceStatusCodes';
import { CONFIRMED_IMPORT_STATUS_CODE, UNRESOLVED_IMPORT_STATUS_CODES } from './importedTimeEntries';

export async function documentStillNeeded(tx: Transaction, documentId: string): Promise<boolean> {
  const [needed] = await tx
    .select({ id: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .leftJoin(invoice, eq(invoiceImport.invoiceId, invoice.invoiceId))
    .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(
      and(
        eq(invoiceImport.documentId, documentId),
        or(
          inArray(invoiceImportStatuses.code, UNRESOLVED_IMPORT_STATUS_CODES),
          and(eq(invoiceImportStatuses.code, CONFIRMED_IMPORT_STATUS_CODE), ne(invoiceStatuses.code, WITHDRAWN_INVOICE_STATUS_CODE)),
        ),
      ),
    )
    .limit(1);
  return Boolean(needed);
}

// Marks the file deleted if nothing needs it any more, returning its storage
// reference for the caller to delete after commit. The caller holds the
// document row lock.
export async function releaseDocumentIfUnneeded(tx: Transaction, documentId: string): Promise<string | undefined> {
  if (await documentStillNeeded(tx, documentId)) {
    return undefined;
  }
  const [released] = await tx
    .update(document)
    .set({ contentDeletedAt: new Date() })
    .where(and(eq(document.documentId, documentId), sql`${document.contentDeletedAt} is null`))
    .returning({ storageReference: document.storageReference });
  return released?.storageReference;
}

// The file behind a request's confirmed import, for withdrawing it.
export async function confirmedDocumentIds(tx: Transaction, invoiceId: string): Promise<string[]> {
  const rows = await tx
    .select({ documentId: invoiceImport.documentId })
    .from(invoiceImport)
    .where(eq(invoiceImport.invoiceId, invoiceId));
  return rows.map((row) => row.documentId);
}
