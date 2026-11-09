// A case time log, CSV or XLSX, read for comparing with an invoice (../billing/timeLogCheck.ts).
import { readSheet } from 'read-excel-file/node';
import { parseCsvRows } from './parseSpreadsheet';
import { UnreadableInvoiceFileError } from './parsedInvoice';

export interface TimeLogEntry {
  // The entry's row in the file, which links and the page refer to.
  key: string;
  entryId: string | null;
  date: string | null;
  hours: number | null;
  worker: string;
  details: string | null;
  // 24-hour HH:MM.
  start: string | null;
  stop: string | null;
}

export const TIME_LOG_FIELDS = ['date', 'hours', 'minutes', 'worker', 'details', 'entryId', 'start', 'stop'] as const;
export type TimeLogField = (typeof TIME_LOG_FIELDS)[number];
// Column positions, from 0. Time spent is in `hours`, or else in `minutes`.
export type TimeLogColumns = Partial<Record<TimeLogField, number>>;

export const MAX_TIME_LOG_ENTRIES = 5000;
// Exports may put a title or date range above the header.
const HEADER_SEARCH_ROWS = 10;

// Cells as kept: spreadsheet dates and times become ISO strings.
export type TimeLogCell = string | number | null;

// Header patterns per field, most telling first; a header matching `avoid` is never used.
const HEADER_RULES: Record<TimeLogField, { rules: Array<[RegExp, number]>; avoid?: RegExp }> = {
  entryId: {
    rules: [[/^((time )?entry |record )?(id|#|no\.?|number)(?![a-z])/, 3], [/\bid\b/, 1]],
    avoid: /client|case|matter|user|staff|employee/,
  },
  date: {
    rules: [[/(service|work|activity|entry) date|date (of|worked)/, 3], [/^date$/, 2], [/date/, 1]],
    avoid: /created|modified|updated|entered|birth|due|opened|closed|start date|end date/,
  },
  hours: {
    rules: [
      [/^(total |billable |billed |actual )?(hours|hrs|time)( spent| worked| billed)?( \((h|hrs|hours)\))?$/, 3],
      [/duration|hours|hrs/, 2],
    ],
    avoid: /minutes|mins|rate|amount|start|stop|end|time (in|out)|type/,
  },
  minutes: { rules: [[/minutes|\bmins?\b/, 3]], avoid: /rate|amount/ },
  worker: {
    rules: [
      [/caseworker|timekeeper|worker|attorney|advocate|provider|employee|staff|user/, 3],
      [/^(name|person|who)$/, 2],
      [/name|person/, 1],
    ],
    avoid: /client|case (name|number|no|title|type)|^case$|matter|party|opposing|type|role|code|\bid\b/,
  },
  details: { rules: [[/details|description|narrative|notes?|comments?|summary|memo/, 3], [/activity$/, 1]], avoid: /type|code/ },
  start: { rules: [[/^(start|begin)( time)?$|^time in$|^from$/, 3], [/start time/, 2]], avoid: /date/ },
  stop: { rules: [[/^(stop|end|finish)( time)?$|^time out$|^to$/, 3], [/(stop|end) time/, 2]], avoid: /date/ },
};

const normalHeader = (header: string) => header.toLowerCase().replace(/[_\s]+/g, ' ').trim();

// Each column goes to the field it fits best, most telling first; ties to the leftmost.
export function detectTimeLogColumns(headers: string[]): TimeLogColumns {
  const candidates: Array<{ field: TimeLogField; index: number; score: number }> = [];
  headers.forEach((header, index) => {
    const text = normalHeader(header);
    for (const field of TIME_LOG_FIELDS) {
      const { rules, avoid } = HEADER_RULES[field];
      if (text === '' || avoid?.test(text)) continue;
      const score = rules.find(([pattern]) => pattern.test(text))?.[1];
      if (score) candidates.push({ field, index, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const columns: TimeLogColumns = {};
  const used = new Set<number>();
  for (const { field, index } of candidates) {
    if (columns[field] === undefined && !used.has(index)) {
      columns[field] = index;
      used.add(index);
    }
  }
  return columns;
}

export function hasRequiredColumns(columns: TimeLogColumns, headerCount: number): boolean {
  const valid = (field: TimeLogField) => columns[field] !== undefined && columns[field]! < headerCount;
  return valid('date') && valid('worker') && (valid('hours') || valid('minutes'));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

// Spreadsheet day numbers count from 1899-12-30.
const fromSerial = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));

export function parseLogDate(cell: TimeLogCell | undefined): string | null {
  if (typeof cell === 'number') {
    return cell > 0 ? fromSerial(cell).toISOString().slice(0, 10) : null;
  }
  const text = String(cell ?? '').trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) {
    return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = Number(match[3]);
    return isoDate(year < 100 ? 2000 + year : year, Number(match[1]), Number(match[2]));
  }
  match = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : isoDate(Number(match[3]), month + 1, Number(match[2]));
  }
  return null;
}

// Decimal hours, h:mm, or hours and minutes in words ("1h 30m", "90 min").
export function parseLogHours(cell: TimeLogCell | undefined): number | null {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) && cell >= 0 ? cell : null;
  }
  const text = String(cell ?? '').trim().toLowerCase();
  // A spreadsheet duration cell, kept as an ISO date-time counted from 1899-12-30.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(text)) {
    const hours = (Date.parse(text.toUpperCase()) - Date.UTC(1899, 11, 30)) / 3_600_000;
    return Number.isFinite(hours) && hours >= 0 ? hours : null;
  }
  const clock = /^(\d{1,3}):(\d{2})$/.exec(text);
  if (clock) {
    return Number(clock[1]) + Number(clock[2]) / 60;
  }
  const words = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?))?$/.exec(text);
  if (words && (words[1] || words[2])) {
    return Number(words[1] ?? 0) + Number(words[2] ?? 0) / 60;
  }
  const hours = Number(text);
  return text !== '' && Number.isFinite(hours) && hours >= 0 ? hours : null;
}

export function parseLogMinutes(cell: TimeLogCell | undefined): number | null {
  const text = String(cell ?? '').trim().toLowerCase();
  if (typeof cell === 'string' && /[a-z:]/.test(text)) {
    return parseLogHours(cell);
  }
  const minutes = typeof cell === 'number' ? cell : Number(text);
  return text !== '' && Number.isFinite(minutes) && minutes >= 0 ? minutes / 60 : null;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function parseLogTime(cell: TimeLogCell | undefined): string | null {
  if (typeof cell === 'number') {
    return cell >= 0 && cell < 1 ? hhmm(Math.round(cell * 1440)) : null;
  }
  const text = String(cell ?? '').trim();
  // A spreadsheet time cell, kept as an ISO date-time.
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(text);
  if (iso) {
    return hhmm(Number(iso[1]) * 60 + Number(iso[2]));
  }
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(text);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
  if (hour > 23 || minute > 59 || (meridiem && (hour < 1 || hour > 12))) {
    return null;
  }
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return hhmm(hour * 60 + minute);
}

const optional = (cell: TimeLogCell | undefined) => {
  const text = String(cell ?? '').trim();
  return text === '' ? null : text;
};

async function readRows(bytes: Buffer, fileName: string): Promise<TimeLogCell[][]> {
  if (/\.csv$/i.test(fileName)) {
    return parseCsvRows(bytes.toString('utf8'));
  }
  if (!/\.xlsx$/i.test(fileName)) {
    throw new UnreadableInvoiceFileError('Upload the time log as a .xlsx or .csv file.');
  }
  let rows: unknown[][];
  try {
    rows = (await readSheet(bytes)) as unknown as unknown[][];
  } catch {
    throw new UnreadableInvoiceFileError('The spreadsheet could not be read.');
  }
  return rows.map((row) =>
    row.map((cell) => (cell instanceof Date ? (Number.isNaN(cell.getTime()) ? null : cell.toISOString()) : typeof cell === 'number' ? cell : cell == null ? null : String(cell))),
  );
}

const headersOf = (row: TimeLogCell[] | undefined) => (row ?? []).map((cell) => String(cell ?? '').trim());

// The first top row naming a date, who and time spent, else the first non-empty row.
export function findHeaderRow(rows: TimeLogCell[][]): number {
  const top = rows.slice(0, HEADER_SEARCH_ROWS);
  const named = top.findIndex((row) => hasRequiredColumns(detectTimeLogColumns(headersOf(row)), row.length));
  return named >= 0 ? named : Math.max(0, top.findIndex((row) => row.some((cell) => optional(cell) !== null)));
}

export interface TimeLogSheet {
  rows: TimeLogCell[][];
  headerRow: number;
}

export const sheetHeaders = (sheet: TimeLogSheet) => headersOf(sheet.rows[sheet.headerRow]);

export function entriesFrom(sheet: TimeLogSheet, columns: TimeLogColumns): TimeLogEntry[] {
  const cell = (row: TimeLogCell[], field: TimeLogField) => (columns[field] === undefined ? undefined : row[columns[field]!]);
  return sheet.rows
    .map((row, index) => ({ row, number: index + 1 }))
    .slice(sheet.headerRow + 1)
    .filter(({ row }) => row.some((value) => optional(value) !== null))
    .map(({ row, number }) => ({
      key: `r${number}`,
      entryId: optional(cell(row, 'entryId')),
      date: parseLogDate(cell(row, 'date')),
      hours: columns.hours !== undefined ? parseLogHours(cell(row, 'hours')) : parseLogMinutes(cell(row, 'minutes')),
      worker: optional(cell(row, 'worker')) ?? '',
      details: optional(cell(row, 'details')),
      start: parseLogTime(cell(row, 'start')),
      stop: parseLogTime(cell(row, 'stop')),
    }));
}

export type ReadTimeLog =
  | { needsColumns: true; headers: string[] }
  | { needsColumns: false; headers: string[]; sheet: TimeLogSheet; columns: TimeLogColumns; entries: TimeLogEntry[] };

// With `chosen`, those columns are used instead of the ones found by header.
export async function readTimeLog(bytes: Buffer, fileName: string, chosen?: TimeLogColumns): Promise<ReadTimeLog> {
  const rows = await readRows(bytes, fileName);
  const sheet = { rows, headerRow: findHeaderRow(rows) };
  const headers = sheetHeaders(sheet);
  if (headers.every((header) => header === '')) {
    throw new UnreadableInvoiceFileError('The time log has no header row.');
  }
  const columns = chosen ?? detectTimeLogColumns(headers);
  if (!hasRequiredColumns(columns, headers.length)) {
    return { needsColumns: true, headers };
  }
  const entries = entriesFrom(sheet, columns);
  if (entries.length > MAX_TIME_LOG_ENTRIES) {
    throw new UnreadableInvoiceFileError(`The time log has more than ${MAX_TIME_LOG_ENTRIES} entries; export one case's time.`);
  }
  return { needsColumns: false, headers, sheet, columns, entries };
}
