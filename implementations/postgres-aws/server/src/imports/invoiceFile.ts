// A request's file as read: the import behind it, each line as first drafted
// from the file, and what the submitter changed since. Changes are worked out
// from the immutable extraction result, so removed lines stay visible and
// need no decision (model/schema.yaml invoice_line.source_location).
import { eq, inArray } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { document, invoiceImport, invoiceImportFormats, invoiceImportStatuses } from '../db/schema';
import { NotFoundError } from '../errors';
import type { DocumentStore } from './documentStore';
import type { ImportWarning, SourceRegion } from './parsedInvoice';

export interface FileLine {
  location: string;
  // Where on the PDF it was read, for highlighting; null for other formats.
  region: SourceRegion | null;
  lineType: string | null;
  serviceDate: string | null;
  description: string | null;
  quantity: number | null;
  unitRate: number | null;
  amount: number | null;
}

export interface FileSource {
  invoiceImportId: string;
  importStatusCode: string;
  fileName: string;
  formatCode: string;
  fileAvailable: boolean;
  invoiceNumber: string | null;
  statedTotal: number | null;
  lines: FileLine[];
  warnings: ImportWarning[];
}

interface StoredLine {
  location: string;
  region?: SourceRegion;
  drafted?: {
    line_type?: string;
    service_date?: string | null;
    description?: string | null;
    quantity?: number | null;
    unit_rate?: number | null;
    amount?: number | null;
  };
  line_type?: { value: string };
  service_date?: { value: string };
  description?: { value: string };
  quantity?: { value: number };
  unit_rate?: { value: number };
  amount?: { value: number };
}

interface StoredResult {
  invoice?: { invoice_number?: { value: string }; stated_total?: { value: number } };
  lines?: StoredLine[];
  warnings?: ImportWarning[];
}

// Imports from before drafted values were kept fall back to the raw reading.
function fileLine(line: StoredLine): FileLine {
  const drafted = line.drafted;
  return {
    location: line.location,
    region: line.region ?? null,
    lineType: drafted?.line_type ?? line.line_type?.value ?? null,
    serviceDate: drafted ? (drafted.service_date ?? null) : (line.service_date?.value ?? null),
    description: drafted ? (drafted.description ?? null) : (line.description?.value ?? null),
    quantity: drafted ? (drafted.quantity ?? null) : (line.quantity?.value ?? null),
    unitRate: drafted ? (drafted.unit_rate ?? null) : (line.unit_rate?.value ?? null),
    amount: drafted ? (drafted.amount ?? null) : (line.amount?.value ?? null),
  };
}

function importRows(db: DatabaseOrTransaction, invoiceIds: string[]) {
  return db
    .select({
      invoiceId: invoiceImport.invoiceId,
      invoiceImportId: invoiceImport.invoiceImportId,
      importStatusCode: invoiceImportStatuses.code,
      extractionResult: invoiceImport.extractionResult,
      fileName: document.displayName,
      mediaType: document.mediaType,
      storageReference: document.storageReference,
      contentDeletedAt: document.contentDeletedAt,
      formatCode: invoiceImportFormats.code,
    })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .innerJoin(invoiceImportFormats, eq(invoiceImport.sourceFormatId, invoiceImportFormats.id))
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .where(inArray(invoiceImport.invoiceId, invoiceIds));
}

async function loadImportRow(db: DatabaseOrTransaction, invoiceId: string) {
  const [row] = await importRows(db, [invoiceId]);
  return row;
}

function fileSourceOf(row: Awaited<ReturnType<typeof importRows>>[number]): FileSource {
  const result = (row.extractionResult ?? {}) as StoredResult;
  return {
    invoiceImportId: row.invoiceImportId,
    importStatusCode: row.importStatusCode,
    fileName: row.fileName,
    formatCode: row.formatCode,
    fileAvailable: row.contentDeletedAt === null,
    invoiceNumber: result.invoice?.invoice_number?.value ?? null,
    statedTotal: result.invoice?.stated_total?.value ?? null,
    lines: (result.lines ?? []).map(fileLine),
    warnings: result.warnings ?? [],
  };
}

// Null for a request typed in rather than read from a file. Callers check
// the reader may see the request.
export async function loadFileSource(db: DatabaseOrTransaction, invoiceId: string): Promise<FileSource | null> {
  const row = await loadImportRow(db, invoiceId);
  return row ? fileSourceOf(row) : null;
}

// The same for several requests, by invoice; those typed in are left out.
export async function loadFileSources(db: DatabaseOrTransaction, invoiceIds: string[]): Promise<Map<string, FileSource>> {
  const rows = invoiceIds.length === 0 ? [] : await importRows(db, invoiceIds);
  return new Map(rows.flatMap((row) => (row.invoiceId ? [[row.invoiceId, fileSourceOf(row)] as const] : [])));
}

// The stored file, for staff viewing a request beside its lines.
export async function readFileForInvoice(db: DatabaseOrTransaction, store: DocumentStore, invoiceId: string) {
  const row = await loadImportRow(db, invoiceId);
  const bytes = row && row.contentDeletedAt === null ? await store.get(row.storageReference) : undefined;
  if (!row || !bytes) {
    throw new NotFoundError('The uploaded file is no longer available.');
  }
  return { bytes, mediaType: row.mediaType, fileName: row.fileName };
}

export interface CurrentLine {
  sourceLocation: string | null;
  lineTypeCode: string | null;
  expenseTypeCode?: string | null;
  serviceDate: string | null;
  description: string | null;
  quantity: string | null;
  unitRate: string | null;
  amount: string;
}

const same = (a: number | null, b: string | number | null) =>
  (a === null && (b === null || b === '')) || (a !== null && b !== null && b !== '' && Math.abs(a - Number(b)) < 0.005);

// Whether a line differs from how it was read, in what the submitter can
// change: date, words, hours or miles, rate (time only) and amount (items
// that aren't priced from rates).
export function lineChanged(read: FileLine, line: CurrentLine): boolean {
  const priced = line.lineTypeCode === 'time' || line.expenseTypeCode === 'mileage';
  return (
    (read.serviceDate ?? null) !== (line.serviceDate ?? null) ||
    (read.description ?? '').trim() !== (line.description ?? '').trim() ||
    !same(read.quantity, line.quantity) ||
    (line.lineTypeCode === 'time' && !same(read.unitRate, line.unitRate)) ||
    (!priced && !same(read.amount, line.amount))
  );
}

// Null for a request imported before lines kept their source location.
export function submitterChanges(source: FileSource, lines: CurrentLine[]) {
  if (lines.length > 0 && lines.every((line) => !line.sourceLocation)) {
    return null;
  }
  const byLocation = new Map(lines.flatMap((line) => (line.sourceLocation ? [[line.sourceLocation, line] as const] : [])));
  const removed = source.lines.filter((read) => !byLocation.has(read.location));
  const changed = source.lines.filter((read) => {
    const line = byLocation.get(read.location);
    return line !== undefined && lineChanged(read, line);
  });
  const added = lines.filter((line) => !line.sourceLocation || !source.lines.some((read) => read.location === line.sourceLocation));
  return { changedCount: changed.length, removedCount: removed.length, addedCount: added.length };
}
