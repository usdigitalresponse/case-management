// A reviewer's case time log (model/rules.yaml check_lines_against_time_log):
// its cells, never the file, kept only while the invoice is in review.
import { z } from 'zod';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { invoice, invoiceLine, invoiceLineTypes, professional, reviewTimeLog } from '../db/schema';
import { ConflictError, ValidationError } from '../errors';
import {
  entriesFrom,
  hasRequiredColumns,
  readTimeLog,
  sheetHeaders,
  TIME_LOG_FIELDS,
  type TimeLogColumns,
  type TimeLogEntry,
} from '../imports/readTimeLog';
import { InvoiceLineNotFoundError } from './reviewInvoiceLine';
import { LINE_REVIEW_STATUS_CODES } from './invoiceStatusCodes';
import { lockInvoiceForReview } from './reviewAssignment';
import { requireReviewPermission } from './reviewAccess';
import { getReviewSettings } from './reviewSettings';
import { compareWithTimeLog, NOT_A_PERSON, type CheckLine, type TimeLogComparison } from './timeLogCheck';

export interface TimeLogView extends TimeLogComparison {
  fileName: string;
  uploadedAt: string;
  blocksApproval: boolean;
  // The header row and the columns used, for the reviewer to check or change.
  headers: string[];
  columns: TimeLogColumns;
}

// Only while in review; anyone on staff, as with deciding lines.
async function beginTimeLogChange(tx: Transaction, invoiceId: string) {
  const locked = await lockInvoiceForReview(tx, invoiceId);
  if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
    throw new ConflictError('invalid_state', 'A time log can only be checked while the invoice is being reviewed.');
  }
}

async function loadLog(db: DatabaseOrTransaction, invoiceId: string) {
  const [log] = await db.select().from(reviewTimeLog).where(eq(reviewTimeLog.invoiceId, invoiceId));
  return log;
}

type StoredLog = NonNullable<Awaited<ReturnType<typeof loadLog>>>;

const entriesOf = (log: StoredLog): TimeLogEntry[] => entriesFrom({ rows: log.rows, headerRow: log.headerRow }, log.columns);

const columnsSchema = z
  .object(Object.fromEntries(TIME_LOG_FIELDS.map((field) => [field, z.number().int().nonnegative().optional()])))
  .optional();

function parseColumns(raw: unknown): TimeLogColumns | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  let value: unknown;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new ValidationError({ columns: 'Choose the columns again.' });
  }
  const parsed = columnsSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError({ columns: 'Choose the columns again.' });
  }
  return parsed.data as TimeLogColumns;
}

// Replaces any earlier log; one whose columns aren't found isn't kept, and returns its headers.
export async function uploadTimeLog(
  db: Database,
  actorUserAccountId: string,
  invoiceId: string,
  input: { fileName?: string; bytes: Buffer; columns?: unknown },
): Promise<{ needsColumns: true; headers: string[] } | { needsColumns: false }> {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  const fileName = input.fileName?.trim().slice(0, 255) || 'time log';
  if (input.bytes.length === 0) {
    throw new ValidationError({ file: 'Choose a time log to upload.' });
  }
  const read = await readTimeLog(input.bytes, fileName, parseColumns(input.columns));
  return db.transaction(async (tx) => {
    await beginTimeLogChange(tx, invoiceId);
    if (read.needsColumns) {
      return { needsColumns: true, headers: read.headers };
    }
    const values = {
      fileName,
      rows: read.sheet.rows,
      headerRow: read.sheet.headerRow,
      columns: read.columns as Record<string, number>,
      workerMatches: {},
      lineLinks: {},
      uploadedByUserAccountId: actorUserAccountId,
      uploadedAt: new Date(),
    };
    await tx
      .insert(reviewTimeLog)
      .values({ invoiceId, ...values })
      .onConflictDoUpdate({ target: reviewTimeLog.invoiceId, set: values });
    return { needsColumns: false };
  });
}

// Keeps confirmed names and links: links are to rows, and names apply wherever they appear.
export async function setTimeLogColumns(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const columns = parseColumns((rawInput as { columns?: unknown } | null)?.columns);
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    await beginTimeLogChange(tx, invoiceId);
    const log = await requireLog(tx, invoiceId);
    if (!columns || !hasRequiredColumns(columns, sheetHeaders(log).length)) {
      throw new ValidationError({ columns: 'Choose the date, who did the work, and the hours or minutes.' });
    }
    await tx.update(reviewTimeLog).set({ columns: columns as Record<string, number> }).where(eq(reviewTimeLog.invoiceId, invoiceId));
    return { invoiceId };
  });
}

const workerInputSchema = z.object({
  name: z.string().max(500),
  // A person on the invoice, NOT_A_PERSON, or null to undo the choice.
  match: z.union([z.uuid(), z.literal(NOT_A_PERSON), z.null()]),
});

export async function setTimeLogWorker(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = workerInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ match: 'Choose who this is.' });
  }
  const { name, match } = parsed.data;
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    await beginTimeLogChange(tx, invoiceId);
    const log = await requireLog(tx, invoiceId);
    if (!entriesOf(log).some((entry) => entry.worker === name)) {
      throw new ValidationError({ name: 'That name is not in the time log.' });
    }
    if (match && match !== NOT_A_PERSON && !(await peopleOn(tx, invoiceId)).some((person) => person.professionalId === match)) {
      throw new ValidationError({ match: 'Choose someone billed on this invoice.' });
    }
    const workerMatches = { ...log.workerMatches };
    if (match === null) delete workerMatches[name];
    else workerMatches[name] = match;
    await tx.update(reviewTimeLog).set({ workerMatches }).where(eq(reviewTimeLog.invoiceId, invoiceId));
    return { invoiceId };
  });
}

const linkInputSchema = z.object({ entryKeys: z.array(z.string().max(20)).max(50) });

// An entry moves from any other line it was linked to; none unlinks the line.
export async function linkTimeLogEntries(db: Database, actorUserAccountId: string, invoiceId: string, invoiceLineId: string, rawInput: unknown) {
  const parsed = linkInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ entryKeys: 'Choose the log entries for this line.' });
  }
  const entryKeys = [...new Set(parsed.data.entryKeys)];
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    await beginTimeLogChange(tx, invoiceId);
    const log = await requireLog(tx, invoiceId);
    const lineIds = (await loadCheckLines(tx, invoiceId)).map((line) => line.invoiceLineId);
    if (!lineIds.includes(invoiceLineId)) {
      throw new InvoiceLineNotFoundError();
    }
    const keys = new Set(entriesOf(log).map((entry) => entry.key));
    if (entryKeys.some((key) => !keys.has(key))) {
      throw new ValidationError({ entryKeys: 'That entry is not in the time log.' });
    }
    const lineLinks: Record<string, string[]> = {};
    for (const [lineId, linked] of Object.entries(log.lineLinks)) {
      const rest = linked.filter((key) => !entryKeys.includes(key));
      if (lineId !== invoiceLineId && rest.length > 0 && lineIds.includes(lineId)) lineLinks[lineId] = rest;
    }
    if (entryKeys.length > 0) lineLinks[invoiceLineId] = entryKeys;
    await tx.update(reviewTimeLog).set({ lineLinks }).where(eq(reviewTimeLog.invoiceId, invoiceId));
    return { invoiceId, invoiceLineId };
  });
}

export async function discardTimeLog(db: Database, actorUserAccountId: string, invoiceId: string) {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    await beginTimeLogChange(tx, invoiceId);
    await removeTimeLog(tx, invoiceId);
    return { invoiceId };
  });
}

// When the round is finished, or the invoice recalled or deleted.
export async function removeTimeLog(tx: Transaction, invoiceId: string) {
  await tx.delete(reviewTimeLog).where(eq(reviewTimeLog.invoiceId, invoiceId));
}

async function requireLog(tx: Transaction, invoiceId: string) {
  const log = await loadLog(tx, invoiceId);
  if (!log) {
    throw new ConflictError('invalid_state', 'Upload a time log first.');
  }
  return log;
}

async function loadCheckLines(db: DatabaseOrTransaction, invoiceId: string): Promise<CheckLine[]> {
  const rows = await db
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      serviceDate: invoiceLine.serviceDate,
      quantity: invoiceLine.quantity,
      professionalId: invoiceLine.timekeeperProfessionalId,
    })
    .from(invoiceLine)
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .where(eq(invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(invoiceLine.position), asc(invoiceLine.serviceDate));
  return rows.map((row) => ({ ...row, quantity: row.quantity === null ? null : Number(row.quantity) }));
}

// Whoever the lines bill for, and the person the invoice is from.
async function peopleOn(db: DatabaseOrTransaction, invoiceId: string, lines?: CheckLine[]) {
  const [header] = await db.select({ professionalId: invoice.professionalId }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
  const ids = [
    ...new Set([
      ...(lines ?? (await loadCheckLines(db, invoiceId))).flatMap((line) => (line.professionalId ? [line.professionalId] : [])),
      ...(header?.professionalId ? [header.professionalId] : []),
    ]),
  ];
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ professionalId: professional.professionalId, displayName: professional.displayName })
    .from(professional)
    .where(inArray(professional.professionalId, ids));
  return rows.map((row) => ({ professionalId: row.professionalId, displayName: row.displayName ?? '' }));
}

async function compare(db: DatabaseOrTransaction, invoiceId: string): Promise<{ log: StoredLog; comparison: TimeLogComparison } | null> {
  const log = await loadLog(db, invoiceId);
  if (!log) {
    return null;
  }
  const [header] = await db
    .select({ periodStart: invoice.periodStart, periodEnd: invoice.periodEnd })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId));
  const lines = await loadCheckLines(db, invoiceId);
  const comparison = compareWithTimeLog({
    lines,
    entries: entriesOf(log),
    people: await peopleOn(db, invoiceId, lines),
    workerMatches: log.workerMatches,
    lineLinks: log.lineLinks,
    period: { start: header?.periodStart ?? null, end: header?.periodEnd ?? null },
  });
  return { log, comparison };
}

// For the review page; null with no log.
export async function loadTimeLogView(db: DatabaseOrTransaction, invoiceId: string): Promise<TimeLogView | null> {
  const compared = await compare(db, invoiceId);
  if (!compared) {
    return null;
  }
  return {
    ...compared.comparison,
    fileName: compared.log.fileName,
    uploadedAt: compared.log.uploadedAt.toISOString(),
    blocksApproval: (await getReviewSettings(db)).timeLogBlocksApproval,
    headers: sheetHeaders(compared.log),
    columns: compared.log.columns,
  };
}

// Lines the log doesn't support as billed, if the setting blocks approving them.
export async function linesBlockedByTimeLog(tx: Transaction, invoiceId: string, lineIds?: string[]): Promise<Set<string>> {
  if (!(await getReviewSettings(tx)).timeLogBlocksApproval) {
    return new Set();
  }
  const compared = await compare(tx, invoiceId);
  const flagged = (compared?.comparison.lines ?? []).filter((line) => line.flagged && (!lineIds || lineIds.includes(line.invoiceLineId)));
  return new Set(flagged.map((line) => line.invoiceLineId));
}

// Approved for the billed hours: as billed, at another rate, or cut by rate alone.
export function keepsBilledHours(
  decision: { approved: boolean; approvedQuantity?: string | null; reasonCodeId?: string | null },
  billedQuantity: string | null,
): boolean {
  if (!decision.approved) return false;
  if (decision.approvedQuantity === null || decision.approvedQuantity === undefined) return !decision.reasonCodeId;
  return billedQuantity === null || Number(decision.approvedQuantity) >= Number(billedQuantity);
}

export const TIME_LOG_BLOCKS_MESSAGE =
  "The time log doesn't support this line as billed. Say why you're approving it anyway, cut its hours, reject it, or link the log entries that support it.";
