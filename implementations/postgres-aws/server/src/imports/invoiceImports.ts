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
  caseTable,
  document,
  invoice,
  invoiceImport,
  invoiceImportFormats,
  invoiceImportStatuses,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  person,
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
import { CONFIRMED_IMPORT_STATUS_CODE, UNRESOLVED_IMPORT_STATUS_CODES } from './importedTimeEntries';
import { priceTimeLines } from '../billing/priceTimeLines';
import { enforceBillingRules } from '../billing/billingRules';
import { matchTimekeeperName } from './matchTimekeeper';
import { checkInferredDates, inferServiceDates } from './inferServiceDates';

export const IMPORT_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

const UNRESOLVED_STATUS_CODES = UNRESOLVED_IMPORT_STATUS_CODES;

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

export function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Display only; never used as a path.
function safeDisplayName(fileName: string | undefined): string {
  const cleaned = (fileName ?? '').replace(/[^\w .()-]/g, '_').trim().slice(0, 200);
  return cleaned || 'uploaded-invoice';
}

// Imports split from the same document don't count as duplicates.
async function duplicateWarnings(
  tx: Transaction,
  importId: string,
  documentId: string,
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
        ne(invoiceImport.documentId, documentId),
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
          ne(invoiceImport.documentId, documentId),
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

function extractionResult(
  importId: string,
  parsed: ParsedInvoice,
  warnings: ImportWarning[],
  // A file designated to one professional: every line is their work.
  designatedProfessionalId?: string,
) {
  const field = <T>(value: T | undefined) => (value === undefined ? undefined : { value });
  return {
    spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
    invoice_import_id: importId,
    designated_professional_id: designatedProfessionalId,
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
      case: field(line.caseLabel),
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
      const documentId = await insertDocument(
        tx,
        actor,
        { storageReference, fileName: input.fileName, mediaType: detected.mediaType, contentHash },
        now,
      );
      const importId = await insertImport(tx, actor, { documentId, caseId, format: detected.format, uploadedAt: now });
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

      const invoiceId = await extractIntoDraft(tx, actor, {
        importId,
        documentId,
        contentHash,
        caseId,
        billedProfessionalId,
        extractionMethod,
        extractedAt,
        parsed,
        everyLineBilled: false,
      });
      return { invoiceImportId: importId, status: 'extracted', invoiceId };
    });
  } catch (error) {
    // Nothing references the stored copy if the records weren't written.
    await store.delete(storageReference);
    throw error;
  }
}

export async function insertDocument(
  tx: Transaction,
  actor: PortalActor,
  file: { storageReference: string; fileName: string | undefined; mediaType: string; contentHash: string },
  now: Date,
): Promise<string> {
  const { documentId } = firstRow(
    await tx
      .insert(document)
      .values({
        storageReference: file.storageReference,
        displayName: safeDisplayName(file.fileName),
        mediaType: file.mediaType,
        contentHash: file.contentHash,
        recordedAt: now,
        recordedByUserAccountId: actor.userAccountId,
      })
      .returning({ documentId: document.documentId }),
  );
  return documentId;
}

export async function insertImport(
  tx: Transaction,
  actor: PortalActor,
  values: { documentId: string; caseId: string; format: string; uploadedAt: Date },
): Promise<string> {
  const imported = firstRow(
    await tx
      .insert(invoiceImport)
      .values({
        documentId: values.documentId,
        uploadedByUserAccountId: actor.userAccountId,
        uploadedAt: values.uploadedAt,
        caseId: values.caseId,
        sourceFormatId: await getReferenceId(tx, invoiceImportFormats, values.format),
        statusId: await importStatusId(tx, 'received'),
      })
      .returning({ invoiceImportId: invoiceImport.invoiceImportId }),
  );
  return imported.invoiceImportId;
}

// Turns parsed lines into the import's draft and records the extraction.
// `everyLineBilled` (a file split by case for one professional) attributes
// every line to the billed professional instead of suggesting timekeepers.
export async function extractIntoDraft(
  tx: Transaction,
  actor: PortalActor,
  args: {
    importId: string;
    documentId: string;
    contentHash: string;
    caseId: string;
    billedProfessionalId: string;
    extractionMethod: string | null;
    extractedAt: Date;
    parsed: ParsedInvoice;
    everyLineBilled: boolean;
  },
): Promise<string> {
  const { importId, parsed, billedProfessionalId, caseId } = args;
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
  warnings.push(
    ...(await duplicateWarnings(tx, importId, args.documentId, args.contentHash, billedProfessionalId, parsed.invoiceNumber)),
  );

  const suggestions = args.everyLineBilled
    ? new Map<string, string>()
    : await suggestTimekeepers(
        tx,
        billedProfessionalId,
        await billableProfessionalIds(tx, actor, caseId),
        parsed.lines.flatMap((line) => (line.timekeeperLabel ? [line.timekeeperLabel] : [])),
      );
  const content: DraftContent = {
    periodStart,
    periodEnd,
    lines: parsed.lines.map((line) => ({
      lineType: line.lineType,
      amount: line.amount,
      // Kept as evidence; time lines are priced from configured rates.
      statedAmount: line.amount,
      serviceDate: line.serviceDate,
      description: line.description,
      quantity: line.quantity !== undefined && line.quantity > 0 ? line.quantity : undefined,
      unitRate: line.unitRate !== undefined && line.unitRate >= 0 ? line.unitRate : undefined,
      timekeeperLabel: line.timekeeperLabel,
      taskCode: line.taskCode,
      activityCode: line.activityCode,
      expenseCode: line.expenseCode,
      // No timekeeper named: suggest the billed professional.
      timekeeperProfessionalId:
        args.everyLineBilled || !line.timekeeperLabel ? billedProfessionalId : suggestions.get(line.timekeeperLabel.toLowerCase()),
    })),
  };
  // Undated lines take the billing period's end where that's safe.
  const inferred = await inferServiceDates(tx, {
    caseId,
    periodStart,
    periodEnd,
    lines: content.lines.map((line, index) => ({
      location: parsed.lines[index]!.location,
      lineType: line.lineType ?? 'other',
      serviceDate: line.serviceDate,
      timekeeperProfessionalId: line.timekeeperProfessionalId,
    })),
  });
  content.lines = content.lines.map((line, index) => ({
    ...line,
    serviceDate: inferred.dates[index],
    serviceDateInferred: inferred.inferred[index],
  }));
  warnings.push(...inferred.warnings);
  const invoiceId = await createDraftInTx(tx, actor, caseId, billedProfessionalId, content, { fillTimekeepers: false });
  await tx
    .update(invoiceImport)
    .set({
      statusId: await importStatusId(tx, 'extracted'),
      extractionMethod: args.extractionMethod,
      extractedAt: args.extractedAt,
      extractionResult: extractionResult(
        importId,
        parsed,
        warnings,
        args.everyLineBilled ? billedProfessionalId : undefined,
      ),
      invoiceId,
    })
    .where(eq(invoiceImport.invoiceImportId, importId));
  return invoiceId;
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

// True when this was the document's last unresolved import, so its file
// is now deleted; a file split by case stays until all its imports resolve.
async function resolveImport(
  tx: Transaction,
  importId: string,
  documentId: string,
  statusCode: string,
  resolvedBy: string | null,
): Promise<boolean> {
  const now = new Date();
  // Serializes sibling imports resolving at once.
  await tx.select({ documentId: document.documentId }).from(document).where(eq(document.documentId, documentId)).for('update');
  await tx
    .update(invoiceImport)
    .set({ statusId: await importStatusId(tx, statusCode), resolvedByUserAccountId: resolvedBy, resolvedAt: now })
    .where(eq(invoiceImport.invoiceImportId, importId));
  const unresolvedStatusIds: string[] = [];
  for (const code of UNRESOLVED_STATUS_CODES) {
    // eslint-disable-next-line no-await-in-loop
    unresolvedStatusIds.push(await importStatusId(tx, code));
  }
  const [open] = await tx
    .select({ invoiceImportId: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .where(and(eq(invoiceImport.documentId, documentId), inArray(invoiceImport.statusId, unresolvedStatusIds)))
    .limit(1);
  if (open) {
    return false;
  }
  await tx.update(document).set({ contentDeletedAt: now }).where(eq(document.documentId, documentId));
  return true;
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
    // A file designated to one professional is all their work.
    const [designation] = await tx
      .select({ professionalId: sql<string | null>`${invoiceImport.extractionResult} ->> 'designated_professional_id'` })
      .from(invoiceImport)
      .where(eq(invoiceImport.invoiceImportId, importId));
    const designated = designation?.professionalId;
    if (designated && lines.some((line) => line.timekeeperProfessionalId !== designated)) {
      throw new ValidationError({ lines: 'Every item in this file is the work of the professional it was imported for.' });
    }
    const unmatched = lines.filter((line) => !line.timekeeperProfessionalId).length;
    if (lines.length === 0 || unmatched > 0) {
      throw new ValidationError({
        lines:
          lines.length === 0
            ? 'Add at least one invoice item before confirming.'
            : `Choose who did the work for ${unmatched} ${unmatched === 1 ? 'item' : 'items'} before confirming.`,
      });
    }
    await checkInferredDates(tx, row.invoiceId);
    // From here the configured rates price each time line, not the file.
    await priceTimeLines(tx, row.invoiceId, {
      billedProfessionalId: draft.professionalId,
      unmatchedMeansBilled: true,
      strict: true,
    });
    await enforceBillingRules(tx, row.invoiceId);
    const released = await resolveImport(tx, importId, row.documentId, CONFIRMED_IMPORT_STATUS_CODE, actor.userAccountId);
    return released ? row.storageReference : undefined;
  });
  if (storageReference) {
    await store.delete(storageReference);
  }
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
    const released = await resolveImport(tx, importId, row.documentId, 'discarded', actor.userAccountId);
    return released ? row.storageReference : undefined;
  });
  if (storageReference) {
    await store.delete(storageReference);
  }
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
    const result = await db.transaction(async (tx) => {
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
      const released = await resolveImport(tx, invoiceImportId, row.documentId, 'discarded', null);
      return { storageReference: released ? row.storageReference : undefined };
    });
    if (result) {
      expired += 1;
      if (result.storageReference) {
        // eslint-disable-next-line no-await-in-loop
        await store.delete(result.storageReference);
      }
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
        where l.invoice_id = ${invoiceImport.invoiceId} and l.service_date is null)`.mapWith(Number),
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
      // Dates filled from the billing period, for the submitter to check.
      inferredDateCount: warnings.filter((warning) => warning.code === 'date_from_period').length,
      otherWarningCount: warnings.filter((warning) => !['date_from_period', 'date_not_inferred'].includes(warning.code)).length,
      // Why it couldn't be read, for a failed import.
      failureMessage: row.statusCode === 'failed' ? (warnings[0]?.message ?? null) : null,
      expiresAt: UNRESOLVED_STATUS_CODES.includes(row.statusCode) ? new Date(row.uploadedAt.getTime() + IMPORT_EXPIRY_MS) : null,
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
