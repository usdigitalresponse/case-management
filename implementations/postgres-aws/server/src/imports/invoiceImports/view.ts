// An import as its uploader sees it, the list in progress, and its file.
import { z } from 'zod';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { type Database } from '../../db/client';
import { caseTable, document, invoice, invoiceImport, invoiceImportFormats, invoiceImportStatuses, invoiceLine, invoiceLineTypes, invoiceStatuses, person, professional, timeEntry } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { type PortalActor } from '../../portal/portalActor';
import { DRAFT_INVOICE_STATUS_CODE } from '../../billing/invoiceStatusCodes';
import { type DocumentStore } from '../documentStore';
import { extractionProgress } from '../extractionJobs';
import { type ImportWarning } from '../parsedInvoice';
import { CONFIRMED_IMPORT_STATUS_CODE } from '../importedTimeEntries';
import { DATE_CHECK_CODES, DATE_CODES, InvoiceImportNotFoundError, UNRESOLVED_STATUS_CODES } from './importStatus';
import { expiryOf } from './resolve';

export async function loadInvoiceImport(db: Database, actor: PortalActor, importId: string) {
  if (!z.uuid().safeParse(importId).success) {
    throw new InvoiceImportNotFoundError();
  }
  const [row] = await db
    .select({
      invoiceImportId: invoiceImport.invoiceImportId,
      uploadedBy: invoiceImport.uploadedByUserAccountId,
      uploadedAt: invoiceImport.uploadedAt,
      caseId: invoiceImport.caseId,
      statusCode: invoiceImportStatuses.code,
      statusDisplayName: invoiceImportStatuses.displayName,
      formatCode: invoiceImportFormats.code,
      formatDisplayName: invoiceImportFormats.displayName,
      extractionMethod: invoiceImport.extractionMethod,
      extractedAt: invoiceImport.extractedAt,
      extractionResult: invoiceImport.extractionResult,
      invoiceId: invoiceImport.invoiceId,
      resolvedAt: invoiceImport.resolvedAt,
      fileName: document.displayName,
      mediaType: document.mediaType,
      storageReference: document.storageReference,
      contentDeletedAt: document.contentDeletedAt,
    })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .innerJoin(invoiceImportFormats, eq(invoiceImport.sourceFormatId, invoiceImportFormats.id))
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .where(eq(invoiceImport.invoiceImportId, importId));
  if (!row || row.uploadedBy !== actor.userAccountId) {
    throw new InvoiceImportNotFoundError();
  }
  return row;
}

// The uploader's imports still in progress, for the bulk import page:
// unresolved, or confirmed with the draft not yet submitted. Oldest first.
export async function listInvoiceImports(db: Database, actor: PortalActor) {
  const rows = await db
    .select({
      invoiceImportId: invoiceImport.invoiceImportId,
      uploadedAt: invoiceImport.uploadedAt,
      statusCode: invoiceImportStatuses.code,
      fileName: document.displayName,
      extractionResult: invoiceImport.extractionResult,
      caseId: invoiceImport.caseId,
      caseExternalReference: caseTable.externalReference,
      caseClientDisplayName: person.displayName,
      invoiceId: invoiceImport.invoiceId,
      invoiceStatusCode: invoiceStatuses.code,
      professionalDisplayName: professional.displayName,
      submittedTotal: invoice.submittedTotal,
      lineCount: sql<number>`(select count(*) from invoice_line l where l.invoice_id = ${invoiceImport.invoiceId})`.mapWith(Number),
      unmatchedCount: sql<number>`(select count(*) from invoice_line l
        where l.invoice_id = ${invoiceImport.invoiceId} and l.timekeeper_professional_id is null)`.mapWith(Number),
      undatedCount: sql<number>`(select count(*) from invoice_line l
        where l.invoice_id = ${invoiceImport.invoiceId} and l.service_date is null and l.source_location is not null)`.mapWith(Number),
      // What the file's lines said, beside the total billed at rates.
      statedTotal: sql<string | null>`(select sum(l.stated_amount)::numeric(12,2)::text from invoice_line l
        where l.invoice_id = ${invoiceImport.invoiceId})`,
    })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .leftJoin(invoice, eq(invoiceImport.invoiceId, invoice.invoiceId))
    .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .leftJoin(caseTable, eq(invoiceImport.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(
      and(
        eq(invoiceImport.uploadedByUserAccountId, actor.userAccountId),
        or(
          inArray(invoiceImportStatuses.code, UNRESOLVED_STATUS_CODES),
          and(eq(invoiceImportStatuses.code, CONFIRMED_IMPORT_STATUS_CODE), eq(invoiceStatuses.code, DRAFT_INVOICE_STATUS_CODE)),
        ),
      ),
    )
    .orderBy(invoiceImport.uploadedAt);
  return rows.map(({ extractionResult, ...row }) => {
    const warnings = (extractionResult as { warnings?: ImportWarning[] } | null)?.warnings ?? [];
    return {
      ...row,
      warningCount: warnings.length,
      inferredDateCount: warnings.filter((warning) => DATE_CHECK_CODES.includes(warning.code)).length,
      otherWarningCount: warnings.filter((warning) => !DATE_CODES.includes(warning.code)).length,
      // Why it couldn't be read, for a failed import.
      failureMessage: row.statusCode === 'failed' ? (warnings[0]?.message ?? null) : null,
      expiresAt: expiryOf(row),
      // Where reading has got to, while the file is still being read.
      progress: row.statusCode === 'received' ? (extractionProgress(row.invoiceImportId) ?? null) : null,
    };
  });
}

export async function getInvoiceImport(db: Database, actor: PortalActor, importId: string) {
  const { uploadedBy: _uploadedBy, storageReference: _storageReference, ...row } = await loadInvoiceImport(db, actor, importId);
  // Existing time matching a line, offered (never applied) as a link.
  const possibleDuplicateTime = row.invoiceId
    ? await db
        .select({
          invoiceLineId: invoiceLine.invoiceLineId,
          timeEntryId: timeEntry.timeEntryId,
          activityOn: timeEntry.activityOn,
          durationHours: timeEntry.durationHours,
          description: timeEntry.description,
        })
        .from(invoiceLine)
        .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
        .innerJoin(
          timeEntry,
          and(
            eq(timeEntry.professionalId, invoiceLine.timekeeperProfessionalId),
            eq(timeEntry.caseId, invoiceLine.caseId),
            eq(timeEntry.activityOn, invoiceLine.serviceDate),
            eq(timeEntry.durationHours, invoiceLine.quantity),
          ),
        )
        .where(
          and(
            eq(invoiceLine.invoiceId, row.invoiceId),
            eq(invoiceLineTypes.code, 'time'),
            isNull(invoiceLine.sourceTimeEntryId),
            or(isNull(timeEntry.sourceInvoiceImportId), ne(timeEntry.sourceInvoiceImportId, importId)),
          ),
        )
    : [];
  return {
    ...row,
    fileAvailable: row.contentDeletedAt === null,
    expiresAt: expiryOf(row),
    progress: row.statusCode === 'received' ? (extractionProgress(importId) ?? null) : null,
    possibleDuplicateTime,
  };
}

export async function readImportFile(db: Database, store: DocumentStore, actor: PortalActor, importId: string) {
  const row = await loadInvoiceImport(db, actor, importId);
  const bytes = row.contentDeletedAt === null ? await store.get(row.storageReference) : undefined;
  if (!bytes) {
    throw new NotFoundError('The uploaded file is no longer available.');
  }
  return { bytes, mediaType: row.mediaType, fileName: row.fileName };
}
