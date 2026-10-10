// Supporting invoice import (model/workflows.yaml invoice_import): a file
// becomes a draft to correct and confirm. The file is deleted on confirm,
// discard or expiry; parsed values stay unchanged in extraction_result.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import {
  document,
  invoice,
  invoiceImport,
  invoiceImportFormats,
  invoiceImportStatuses,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  professional,
  timeEntry,
} from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { NotAssignedToCaseError } from '../portal/caseAssignmentAuthorization';
import { billableProfessionalIds, type PortalActor } from '../portal/portalActor';
import {
  createDraftInTx,
  InvoiceStateError,
  SUBMISSION_SNAPSHOT_SPEC_VERSION,
  withdrawDraftInTx,
  type DraftContent,
} from '../billing/invoiceLifecycle';
import { DRAFT_INVOICE_STATUS_CODE } from '../billing/invoiceStatusCodes';
import type { DocumentStore } from './documentStore';
import { detectInvoiceFile } from './detectFormat';
import { reconciliationWarnings, UnreadableInvoiceFileError, type ImportWarning, type ParsedInvoice } from './parsedInvoice';
import { CONFIRMED_IMPORT_STATUS_CODE } from './importedTimeEntries';
import { matchTimekeeperName } from './matchTimekeeper';

export const IMPORT_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

const UNRESOLVED_STATUS_CODES = ['received', 'extracted', 'failed'];

export class InvoiceImportNotFoundError extends NotFoundError {
  constructor() {
    super('Import not found.');
  }
}

const uploadParamsSchema = z.object({
  caseId: z.string().uuid(),
  professionalId: z.string().uuid().optional(),
});

function importStatusId(db: DatabaseOrTransaction, code: string): Promise<string> {
  return getReferenceId(db, invoiceImportStatuses, code);
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Display only; never used as a path.
function safeDisplayName(fileName: string | undefined): string {
  const cleaned = (fileName ?? '').replace(/[^\w .()-]/g, '_').trim().slice(0, 200);
  return cleaned || 'uploaded-invoice';
}

async function duplicateWarnings(
  tx: Transaction,
  importId: string,
  contentHash: string,
  billedProfessionalId: string,
  invoiceNumber: string | undefined,
): Promise<ImportWarning[]> {
  const warnings: ImportWarning[] = [];
  const sameFile = await tx
    .select({ invoiceImportId: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .innerJoin(invoice, eq(invoiceImport.invoiceId, invoice.invoiceId))
    .where(
      and(
        eq(document.contentHash, contentHash),
        eq(invoice.professionalId, billedProfessionalId),
        ne(invoiceImport.invoiceImportId, importId),
      ),
    )
    .limit(1);
  if (sameFile.length > 0) {
    warnings.push({ code: 'duplicate_file', message: 'This exact file was uploaded before for the same professional.' });
  }
  if (invoiceNumber) {
    const sameNumber = await tx
      .select({ invoiceImportId: invoiceImport.invoiceImportId })
      .from(invoiceImport)
      .innerJoin(invoice, eq(invoiceImport.invoiceId, invoice.invoiceId))
      .where(
        and(
          eq(invoice.professionalId, billedProfessionalId),
          ne(invoiceImport.invoiceImportId, importId),
          sql`${invoiceImport.extractionResult} -> 'invoice' -> 'invoice_number' ->> 'value' = ${invoiceNumber}`,
        ),
      )
      .limit(1);
    if (sameNumber.length > 0) {
      warnings.push({
        code: 'duplicate_invoice_number',
        message: `Invoice number ${invoiceNumber} was already imported for the same professional.`,
      });
    }
  }
  return warnings;
}

// Suggestions only: this payee's earlier match for the same label, else a
// unique name match.
async function suggestTimekeepers(
  tx: Transaction,
  billedProfessionalId: string,
  billable: string[],
  labels: string[],
): Promise<Map<string, string>> {
  const suggestions = new Map<string, string>();
  if (labels.length === 0 || billable.length === 0) {
    return suggestions;
  }
  const lowered = [...new Set(labels.map((label) => label.toLowerCase()))];
  const previous = await tx
    .select({ label: sql<string>`lower(${invoiceLine.timekeeperLabel})`, professionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
    .where(
      and(
        eq(invoice.professionalId, billedProfessionalId),
        isNotNull(invoiceLine.timekeeperProfessionalId),
        inArray(sql`lower(${invoiceLine.timekeeperLabel})`, lowered),
        inArray(invoiceLine.timekeeperProfessionalId, billable),
      ),
    )
    .orderBy(desc(invoice.submittedAt));
  for (const row of previous) {
    if (row.professionalId && !suggestions.has(row.label)) {
      suggestions.set(row.label, row.professionalId);
    }
  }
  const named = await tx
    .select({ professionalId: professional.professionalId, displayName: professional.displayName })
    .from(professional)
    .where(inArray(professional.professionalId, billable));
  for (const label of lowered) {
    const match = suggestions.has(label) ? undefined : matchTimekeeperName(label, named);
    if (match) {
      suggestions.set(label, match);
    }
  }
  return suggestions;
}

function extractionResult(importId: string, parsed: ParsedInvoice, warnings: ImportWarning[]) {
  const field = <T>(value: T | undefined) => (value === undefined ? undefined : { value });
  return {
    spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
    invoice_import_id: importId,
    invoice: {
      invoice_number: field(parsed.invoiceNumber),
      period_start: field(parsed.periodStart),
      period_end: field(parsed.periodEnd),
      stated_total: field(parsed.statedTotal),
    },
    lines: parsed.lines.map((line) => ({
      location: line.location,
      line_type: field(line.lineType),
      service_date: field(line.serviceDate),
      description: field(line.description),
      timekeeper: field(line.timekeeperLabel),
      quantity: field(line.quantity),
      unit_rate: field(line.unitRate),
      amount: field(line.amount),
      task_code: field(line.taskCode),
      activity_code: field(line.activityCode),
      expense_code: field(line.expenseCode),
    })),
    warnings,
  };
}

export interface UploadInvoiceFileInput {
  caseId: unknown;
  professionalId?: unknown;
  fileName: string | undefined;
  bytes: Buffer;
}

export async function uploadInvoiceFile(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  input: UploadInvoiceFileInput,
): Promise<{ invoiceImportId: string; status: string; invoiceId: string | null }> {
  const params = uploadParamsSchema.safeParse({ caseId: input.caseId, professionalId: input.professionalId || undefined });
  if (!params.success) {
    throw new ValidationError({ caseId: 'Choose a case to import the invoice into.' });
  }
  const { caseId } = params.data;
  const billedProfessionalId = params.data.professionalId ?? actor.professionalId;
  if (!billedProfessionalId) {
    throw new ValidationError({ professionalId: 'Choose the professional this invoice bills for.' });
  }
  if (!(await billableProfessionalIds(db, actor, caseId)).includes(billedProfessionalId)) {
    throw new NotAssignedToCaseError();
  }

  const detected = detectInvoiceFile(input.bytes);
  const contentHash = sha256(input.bytes);
  const storageReference = await store.put(input.bytes);

  let parsed: ParsedInvoice | undefined;
  let failure: string | undefined;
  try {
    parsed = await detected.parse();
  } catch (error) {
    if (!(error instanceof UnreadableInvoiceFileError)) {
      await store.delete(storageReference);
      throw error;
    }
    failure = error.fieldErrors.file;
  }

  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const { documentId } = firstRow(
        await tx
          .insert(document)
          .values({
            storageReference,
            displayName: safeDisplayName(input.fileName),
            mediaType: detected.mediaType,
            contentHash,
            recordedAt: now,
            recordedByUserAccountId: actor.userAccountId,
          })
          .returning({ documentId: document.documentId }),
      );
      const imported = firstRow(
        await tx
          .insert(invoiceImport)
          .values({
            documentId,
            uploadedByUserAccountId: actor.userAccountId,
            uploadedAt: now,
            caseId,
            sourceFormatId: await getReferenceId(tx, invoiceImportFormats, detected.format),
            statusId: await importStatusId(tx, 'received'),
          })
          .returning({ invoiceImportId: invoiceImport.invoiceImportId }),
      );
      const importId = imported.invoiceImportId;
      const extractedAt = new Date();
      const { extractionMethod } = detected;

      if (!parsed) {
        await tx
          .update(invoiceImport)
          .set({
            statusId: await importStatusId(tx, 'failed'),
            extractionMethod,
            extractedAt,
            extractionResult: {
              spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
              invoice_import_id: importId,
              warnings: [{ code: 'unreadable', message: failure }],
            },
          })
          .where(eq(invoiceImport.invoiceImportId, importId));
        return { invoiceImportId: importId, status: 'failed', invoiceId: null };
      }

      const warnings = reconciliationWarnings(parsed);
      let { periodStart, periodEnd } = parsed;
      if (periodStart && periodEnd && periodEnd < periodStart) {
        warnings.push({ code: 'inverted_period', message: 'The billing period ends before it starts, so it was left blank.' });
        periodStart = undefined;
        periodEnd = undefined;
      } else if (Boolean(periodStart) !== Boolean(periodEnd)) {
        periodStart = undefined;
        periodEnd = undefined;
      }
      warnings.push(...(await duplicateWarnings(tx, importId, contentHash, billedProfessionalId, parsed.invoiceNumber)));

      const billable = await billableProfessionalIds(tx, actor, caseId);
      const suggestions = await suggestTimekeepers(
        tx,
        billedProfessionalId,
        billable,
        parsed.lines.flatMap((line) => (line.timekeeperLabel ? [line.timekeeperLabel] : [])),
      );
      const content: DraftContent = {
        periodStart,
        periodEnd,
        lines: parsed.lines.map((line) => ({
          lineType: line.lineType,
          amount: line.amount,
          serviceDate: line.serviceDate,
          description: line.description,
          quantity: line.quantity !== undefined && line.quantity > 0 ? line.quantity : undefined,
          unitRate: line.unitRate !== undefined && line.unitRate >= 0 ? line.unitRate : undefined,
          timekeeperLabel: line.timekeeperLabel,
          taskCode: line.taskCode,
          activityCode: line.activityCode,
          expenseCode: line.expenseCode,
          // No timekeeper named: suggest the billed professional.
          timekeeperProfessionalId: line.timekeeperLabel
            ? suggestions.get(line.timekeeperLabel.toLowerCase())
            : billedProfessionalId,
        })),
      };
      const invoiceId = await createDraftInTx(tx, actor, caseId, billedProfessionalId, content, { fillTimekeepers: false });
      await tx
        .update(invoiceImport)
        .set({
          statusId: await importStatusId(tx, 'extracted'),
          extractionMethod,
          extractedAt,
          extractionResult: extractionResult(importId, parsed, warnings),
          invoiceId,
        })
        .where(eq(invoiceImport.invoiceImportId, importId));
      return { invoiceImportId: importId, status: 'extracted', invoiceId };
    });
  } catch (error) {
    // Nothing references the stored copy if the records weren't written.
    await store.delete(storageReference);
    throw error;
  }
}

// Anyone but the uploader gets a 404.
async function lockOwnImport(tx: Transaction, actor: PortalActor, importId: string) {
  if (!z.uuid().safeParse(importId).success) {
    throw new InvoiceImportNotFoundError();
  }
  const [row] = await tx
    .select({
      invoiceImportId: invoiceImport.invoiceImportId,
      uploadedBy: invoiceImport.uploadedByUserAccountId,
      statusCode: invoiceImportStatuses.code,
      invoiceId: invoiceImport.invoiceId,
      documentId: invoiceImport.documentId,
      storageReference: document.storageReference,
    })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .where(eq(invoiceImport.invoiceImportId, importId))
    .for('update', { of: invoiceImport });
  if (!row || row.uploadedBy !== actor.userAccountId) {
    throw new InvoiceImportNotFoundError();
  }
  return row;
}

async function resolveImport(
  tx: Transaction,
  importId: string,
  documentId: string,
  statusCode: string,
  resolvedBy: string | null,
): Promise<void> {
  const now = new Date();
  await tx.update(document).set({ contentDeletedAt: now }).where(eq(document.documentId, documentId));
  await tx
    .update(invoiceImport)
    .set({ statusId: await importStatusId(tx, statusCode), resolvedByUserAccountId: resolvedBy, resolvedAt: now })
    .where(eq(invoiceImport.invoiceImportId, importId));
}

async function lockDraft(tx: Transaction, invoiceId: string) {
  const [row] = await tx
    .select({ statusId: invoice.statusId, caseId: invoice.caseId, professionalId: invoice.professionalId })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId))
    .for('update');
  return row;
}

async function withdrawImportDraft(tx: Transaction, invoiceId: string | null, by: Parameters<typeof withdrawDraftInTx>[2]) {
  if (!invoiceId) {
    return;
  }
  const draft = await lockDraft(tx, invoiceId);
  if (draft && draft.statusId === (await getReferenceId(tx, invoiceStatuses, DRAFT_INVOICE_STATUS_CODE))) {
    await withdrawDraftInTx(tx, invoiceId, by);
  }
}

export async function confirmInvoiceImport(db: Database, store: DocumentStore, actor: PortalActor, importId: string) {
  const storageReference = await db.transaction(async (tx) => {
    const row = await lockOwnImport(tx, actor, importId);
    if (row.statusCode !== 'extracted' || !row.invoiceId) {
      throw new InvoiceStateError('Only an import that was read successfully and not yet resolved can be confirmed.');
    }
    const draft = await lockDraft(tx, row.invoiceId);
    if (!draft || !(await billableProfessionalIds(tx, actor, draft.caseId)).includes(draft.professionalId)) {
      throw new NotAssignedToCaseError();
    }
    const lines = await tx
      .select({ timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId })
      .from(invoiceLine)
      .where(eq(invoiceLine.invoiceId, row.invoiceId));
    const unmatched = lines.filter((line) => !line.timekeeperProfessionalId).length;
    if (lines.length === 0 || unmatched > 0) {
      throw new ValidationError({
        lines:
          lines.length === 0
            ? 'Add at least one invoice item before confirming.'
            : `Choose who did the work for ${unmatched} ${unmatched === 1 ? 'item' : 'items'} before confirming.`,
      });
    }
    await resolveImport(tx, importId, row.documentId, CONFIRMED_IMPORT_STATUS_CODE, actor.userAccountId);
    return row.storageReference;
  });
  await store.delete(storageReference);
  return { invoiceImportId: importId };
}

// Allowed even if the uploader can no longer act for the case.
export async function discardInvoiceImport(db: Database, store: DocumentStore, actor: PortalActor, importId: string) {
  const storageReference = await db.transaction(async (tx) => {
    const row = await lockOwnImport(tx, actor, importId);
    if (!UNRESOLVED_STATUS_CODES.includes(row.statusCode)) {
      throw new InvoiceStateError('This import is already confirmed or discarded.');
    }
    await withdrawImportDraft(tx, row.invoiceId, { actorUserAccountId: actor.userAccountId });
    await resolveImport(tx, importId, row.documentId, 'discarded', actor.userAccountId);
    return row.storageReference;
  });
  await store.delete(storageReference);
  return { invoiceImportId: importId };
}

// Discards unresolved imports three days after upload, as a system action,
// and retries recent file deletions that may not have completed.
export async function expireInvoiceImports(db: Database, store: DocumentStore, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IMPORT_EXPIRY_MS);
  const unresolvedStatusIds = await Promise.all(UNRESOLVED_STATUS_CODES.map((code) => importStatusId(db, code)));
  const stale = await db
    .select({ invoiceImportId: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .where(and(inArray(invoiceImport.statusId, unresolvedStatusIds), lt(invoiceImport.uploadedAt, cutoff)));

  let expired = 0;
  for (const { invoiceImportId } of stale) {
    // eslint-disable-next-line no-await-in-loop
    const storageReference = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          statusId: invoiceImport.statusId,
          invoiceId: invoiceImport.invoiceId,
          documentId: invoiceImport.documentId,
          storageReference: document.storageReference,
        })
        .from(invoiceImport)
        .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
        .where(eq(invoiceImport.invoiceImportId, invoiceImportId))
        .for('update', { of: invoiceImport });
      // Resolved by its uploader since the scan.
      if (!row || !unresolvedStatusIds.includes(row.statusId)) {
        return undefined;
      }
      await withdrawImportDraft(tx, row.invoiceId, {
        actorUserAccountId: null,
        reason: 'The import expired three days after upload without being confirmed.',
      });
      await resolveImport(tx, invoiceImportId, row.documentId, 'discarded', null);
      return row.storageReference;
    });
    if (storageReference) {
      // eslint-disable-next-line no-await-in-loop
      await store.delete(storageReference);
      expired += 1;
    }
  }

  const deleted = await db
    .select({ storageReference: document.storageReference })
    .from(document)
    .where(gte(document.contentDeletedAt, cutoff));
  for (const { storageReference } of deleted) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(storageReference);
  }
  return expired;
}

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
    expiresAt: UNRESOLVED_STATUS_CODES.includes(row.statusCode)
      ? new Date(row.uploadedAt.getTime() + IMPORT_EXPIRY_MS)
      : null,
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
