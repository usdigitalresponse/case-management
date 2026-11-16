// Runs in the background queue; parsed values stay unchanged in extraction_result.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { type Database, type Transaction } from '../../db/client';
import { invoice, invoiceImport, invoiceImportStatuses, invoiceLine, professional } from '../../db/schema';
import { billableProfessionalIds, type PortalActor } from '../../portal/portalActor';
import { createDraftInTx } from '../../billing/invoiceLifecycle/drafts';
import { type DraftContent } from '../../billing/invoiceLifecycle/lineInput';
import { SUBMISSION_SNAPSHOT_SPEC_VERSION } from '../../billing/invoiceLifecycle/submit';
import { type DocumentStore } from '../documentStore';
import { detectInvoiceFile } from '../detectFormat';
import { suggestUploadCase, uploadCases } from '../caseSuggestions';
import { type ProposedCase, type ProposedProvider } from '../../billing/proposedDetails';
import { documentExtractor } from '../extractors';
import { enqueueExtraction } from '../extractionJobs';
import { ExtractionCancelledError, isolationEnabled, parseIsolated } from '../isolatedExtraction';
import { reconciliationWarnings, suggestMileage, UnreadableInvoiceFileError, type ImportWarning, type ParsedInvoice } from '../parsedInvoice';
import { matchTimekeeperName } from '../matchTimekeeper';
import { fillMissingDates } from '../undatedLines';
import { fallbackTimekeeper } from '../../billing/timekeeperFallback';
import { readCaseNumber } from '../../billing/caseNumbers';
import { duplicateWarnings } from '../duplicateWarnings';
import { importStatusId } from './importStatus';

// Suggestions only: this payee's earlier match for the same label, else a
// unique name match.
async function suggestTimekeepers(
  tx: Transaction,
  // Null: no payee yet, so only name matches.
  billedProfessionalId: string | null,
  billable: string[],
  labels: string[],
): Promise<Map<string, string>> {
  const suggestions = new Map<string, string>();
  if (labels.length === 0 || billable.length === 0) {
    return suggestions;
  }
  const lowered = [...new Set(labels.map((label) => label.toLowerCase()))];
  const previous = !billedProfessionalId ? [] : await tx
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

export function extractionResult(
  importId: string,
  parsed: ParsedInvoice,
  warnings: ImportWarning[],
  // A file designated to one professional: every line is their work.
  designatedProfessionalId?: string,
  // Each line as first drafted from the file (mileage suggested, dates
  // inferred), which the submitter's changes are shown against.
  drafted: DraftContent['lines'] = [],
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
      case_number: readCaseNumber(parsed) ?? undefined,
    },
    lines: parsed.lines.map((line, index) => ({
      location: line.location,
      region: line.region,
      drafted: drafted[index] && {
        line_type: drafted[index].lineType,
        service_date: drafted[index].serviceDate ?? null,
        description: drafted[index].description ?? null,
        quantity: drafted[index].quantity ?? null,
        unit_rate: drafted[index].unitRate ?? null,
        amount: drafted[index].amount ?? null,
      },
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
    suggested_lines: (parsed.suggestedLines ?? []).map((line) => ({
      location: line.location,
      region: line.region,
      line_type: field(line.lineType),
      service_date: field(line.serviceDate),
      description: field(line.description),
      quantity: field(line.quantity),
      unit_rate: field(line.unitRate),
      amount: field(line.amount),
    })),
    warnings,
  };
}

interface ReadOutcome {
  parsed?: ParsedInvoice;
  // Why the file couldn't be read, shown to the uploader.
  failure?: string;
  // Anything else went wrong; rethrown by synchronous uploads.
  error?: unknown;
}

export async function readFile(parse: () => Promise<ParsedInvoice>): Promise<ReadOutcome> {
  try {
    return { parsed: await parse() };
  } catch (error) {
    return error instanceof UnreadableInvoiceFileError ? { failure: error.fieldErrors.file } : { error };
  }
}

interface ExtractionTarget {
  importId: string;
  documentId: string;
  contentHash: string;
  caseId: string | null;
  // Null: a staff import whose professional is chosen on matching.
  billedProfessionalId: string | null;
  extractionMethod: string;
  fileName: string | undefined;
}

// Marks the import extracted, with its draft, or failed with the reason.
export async function recordExtraction(
  tx: Transaction,
  actor: PortalActor,
  target: ExtractionTarget,
  outcome: Pick<ReadOutcome, 'parsed' | 'failure'>,
): Promise<{ invoiceImportId: string; status: string; invoiceId: string | null }> {
  const extractedAt = new Date();
  const { extractionMethod } = target;
  if (!outcome.parsed) {
    await tx
      .update(invoiceImport)
      .set({
        statusId: await importStatusId(tx, 'failed'),
        extractionMethod,
        extractedAt,
        extractionResult: {
          spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
          invoice_import_id: target.importId,
          warnings: [{ code: 'unreadable', message: outcome.failure }],
        },
      })
      .where(eq(invoiceImport.invoiceImportId, target.importId));
    return { invoiceImportId: target.importId, status: 'failed', invoiceId: null };
  }
  const invoiceId = await extractIntoDraft(tx, actor, {
    ...target,
    extractionMethod,
    extractedAt,
    parsed: outcome.parsed,
    everyLineBilled: false,
  });
  return { invoiceImportId: target.importId, status: 'extracted', invoiceId };
}

const UNEXPECTED_FAILURE = 'This file couldn’t be read because of an unexpected error. Discard it and upload it again.';

// Out here so the waiting job holds only the stored file's reference, not
// the upload's bytes; they're read back from the store when it starts.
export function queueBackgroundRead(db: Database, store: DocumentStore, actor: PortalActor, storageReference: string, target: ExtractionTarget) {
  void enqueueExtraction(target.importId, async (onProgress, signal) => {
    const bytes = await store.get(storageReference);
    if (!bytes) {
      await recordInBackground(db, actor, target, { failure: 'The uploaded file is no longer available. Upload it again.' });
      return;
    }
    const outcome = await readFile(() =>
      isolationEnabled() ? parseIsolated(bytes, onProgress, { signal }) : detectInvoiceFile(bytes).parse({ onProgress }),
    );
    // Discarded meanwhile: nothing to record.
    if (signal.aborted || outcome.error instanceof ExtractionCancelledError) {
      return;
    }
    await recordInBackground(db, actor, target, outcome);
  }).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Background extraction failed', error);
  });
}

// Records a background result unless the import was discarded or expired
// meanwhile; an unexpected error still resolves it as failed.
async function recordInBackground(db: Database, actor: PortalActor, target: ExtractionTarget, outcome: ReadOutcome) {
  const record = (result: Pick<ReadOutcome, 'parsed' | 'failure'>) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .select({ statusCode: invoiceImportStatuses.code })
        .from(invoiceImport)
        .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
        .where(eq(invoiceImport.invoiceImportId, target.importId))
        .for('update', { of: invoiceImport });
      if (row?.statusCode === 'received') {
        await recordExtraction(tx, actor, target, result);
      }
    });
  if (outcome.error) {
    // eslint-disable-next-line no-console
    console.error('Extraction failed', outcome.error);
    await record({ failure: UNEXPECTED_FAILURE });
    return;
  }
  try {
    await record(outcome);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Recording an extraction failed', error);
    await record({ failure: UNEXPECTED_FAILURE });
  }
}

// The queue lives in this process, so imports still received at startup were interrupted: they fail, asking for
// another upload.
export async function failInterruptedExtractions(db: Database): Promise<number> {
  const receivedId = await importStatusId(db, 'received');
  const extractor = documentExtractor();
  const interrupted = await db
    .select({ invoiceImportId: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .where(and(eq(invoiceImport.statusId, receivedId), isNull(invoiceImport.extractedAt)));
  for (const { invoiceImportId } of interrupted) {
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(invoiceImport)
      .set({
        // eslint-disable-next-line no-await-in-loop
        statusId: await importStatusId(db, 'failed'),
        extractionMethod: `${extractor.id} ${extractor.version}`,
        extractedAt: new Date(),
        extractionResult: {
          spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
          invoice_import_id: invoiceImportId,
          warnings: [{ code: 'interrupted', message: 'Reading this file was interrupted. Discard it and upload it again.' }],
        },
      })
      .where(and(eq(invoiceImport.invoiceImportId, invoiceImportId), eq(invoiceImport.statusId, receivedId)));
  }
  return interrupted.length;
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
    caseId: string | null;
    billedProfessionalId: string | null;
    extractionMethod: string | null;
    extractedAt: Date;
    parsed: ParsedInvoice;
    fileName?: string;
    everyLineBilled: boolean;
    // ../../billing/timekeeperFallback.ts
    timekeeperFallback?: boolean;
    // The billing period the uploader checked, in place of the one read;
    // the extraction record keeps what was read.
    checkedPeriod?: { start?: string; end?: string };
    proposedCase?: ProposedCase;
    proposedProvider?: ProposedProvider;
  },
): Promise<string> {
  const { importId, billedProfessionalId, caseId } = args;
  // The extraction record keeps the file's own classification.
  const parsed = { ...args.parsed, lines: args.parsed.lines.map(suggestMileage) };
  // Checks the file's own figures, not miles taken from a description.
  const warnings = reconciliationWarnings(args.parsed);
  let { periodStart, periodEnd } = args.checkedPeriod
    ? { periodStart: args.checkedPeriod.start, periodEnd: args.checkedPeriod.end }
    : parsed;
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
        args.everyLineBilled || !line.timekeeperLabel
          ? (billedProfessionalId ?? undefined)
          : suggestions.get(line.timekeeperLabel.toLowerCase()),
      sourceLocation: line.location,
    })),
  };
  if (args.timekeeperFallback) {
    const fallback = fallbackTimekeeper(
      content.lines.map((line) => line.timekeeperProfessionalId),
      billedProfessionalId,
    );
    content.lines = content.lines.map((line) => ({ ...line, timekeeperProfessionalId: line.timekeeperProfessionalId ?? fallback ?? undefined }));
  }
  const filled = fillMissingDates(parsed.lines);
  content.lines = content.lines.map((line, index) => ({ ...line, serviceDate: filled.dates[index] }));
  warnings.push(...filled.warnings);
  const invoiceId = await createDraftInTx(tx, actor, caseId, billedProfessionalId, content, {
    fillTimekeepers: false,
    proposedCase: args.proposedCase,
    proposedProvider: args.proposedProvider,
  });
  const suggested = caseId === null ? suggestUploadCase(await uploadCases(tx, actor), args.parsed, args.fileName) : null;
  await tx
    .update(invoiceImport)
    .set({
      suggestedCaseId: suggested?.caseId ?? null,
      suggestedProfessionalId: suggested?.professionalId ?? null,
      statusId: await importStatusId(tx, 'extracted'),
      extractionMethod: args.extractionMethod,
      extractedAt: args.extractedAt,
      extractionResult: extractionResult(
        importId,
        args.parsed,
        warnings,
        args.everyLineBilled ? (billedProfessionalId ?? undefined) : undefined,
        content.lines,
      ),
      invoiceId,
    })
    .where(eq(invoiceImport.invoiceImportId, importId));
  return invoiceId;
}
