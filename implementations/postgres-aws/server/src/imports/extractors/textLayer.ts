// Reads a digital PDF's text layer in-process: rebuilds rows from text
// positions, finds the item table by its headings and reads one item per row
// with an amount. Scans and table-less layouts fail.
import { join } from 'node:path';
import type { LineType } from '../../billing/invoiceLifecycle';
import { checkLineCount, optionalText, UnreadableInvoiceFileError, type ParsedInvoice, type ParsedLine } from '../parsedInvoice';
import type { InvoiceExtractor } from './types';

// Upload defaults (docs/invoice-import-export-plan.md "Upload defaults").
const MAX_PAGES = 50;
// In points.
const ROW_TOLERANCE = 2;
const COLUMN_TOLERANCE = 2;

interface Cell {
  x: number;
  width: number;
  text: string;
}

interface Row {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

type Column = 'date' | 'timekeeper' | 'description' | 'hours' | 'rate' | 'amount' | 'task' | 'activity';

// Each heading's horizontal extent.
type Columns = Map<Column, { x: number; end: number }>;

const HEADINGS: Array<[Column, RegExp]> = [
  ['date', /^(date|service date|date of service)$/i],
  ['timekeeper', /^(timekeeper|attorney|staff|professional|name|biller|billed by|ee|tk|initials|timekeeper initials)$/i],
  // A section title can head the description column ("Time Entries |
  // Billed By | Price | Qty | Sub").
  ['description', /^(description|services?|narrative|category|details?|work performed|time entries|time|expenses|disbursements)$/i],
  ['hours', /^(hours|hrs|qty|quantity|units)$/i],
  ['rate', /^(rate|price|unit cost|unit price|hourly rate)$/i],
  ['amount', /^(amount|total|fees?|amount claimed|line total|charges?|sub|subtotal)$/i],
  ['task', /^(task|task code|utbms task)$/i],
  ['activity', /^(activity|activity code)$/i],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_PATTERN = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\.? \d{1,2}, \d{4})/g;
const MONEY_PATTERN = /\(?-?\$?\s?\d[\d,]*(?:\.\d{1,2})?\)?/g;
const EXPENSE_WORDS = /\b(expenses?|fees?|costs?|mileage|travel|copies|copying|postage|filing|courier|transcripts?)\b/i;

// PDF.js is ESM-only; this CommonJS server require()s it (Node 22.12+).
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<PdfTextItem | object> }> }>;
    }>;
    destroy(): Promise<void>;
  };
}
let pdfjs: PdfJs | undefined;
function loadPdfJs(): PdfJs {
  if (!pdfjs) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs') as PdfJs;
    // Runs in-process ("fake worker"); this only tells PDF.js where it is.
    pdfjs.GlobalWorkerOptions.workerSrc = join(require.resolve('pdfjs-dist/package.json'), '..', 'legacy/build/pdf.worker.mjs');
  }
  return pdfjs;
}

async function readRows(bytes: Buffer): Promise<Row[]> {
  const { getDocument } = loadPdfJs();
  // Only the text layer is read: no fonts are loaded, and PDF.js's core
  // never runs a document's scripts (only its viewer's sandbox does).
  const task = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    let document;
    try {
      document = await task.promise;
    } catch {
      throw new UnreadableInvoiceFileError('This PDF could not be opened. It may be damaged or password-protected.');
    }
    if (document.numPages > MAX_PAGES) {
      throw new UnreadableInvoiceFileError(`PDFs can have at most ${MAX_PAGES} pages.`);
    }
    const rows: Row[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      // eslint-disable-next-line no-await-in-loop
      const content = await (await document.getPage(pageNumber)).getTextContent();
      const items = content.items
        .filter((item): item is PdfTextItem => 'str' in item && item.str.trim() !== '')
        .map((item) => ({ x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width, text: item.str.trim() }))
        // PDF y grows upward, so higher y is nearer the top.
        .sort((a, b) => b.y - a.y || a.x - b.x);
      for (const item of items) {
        const row = rows[rows.length - 1];
        const cell = { x: item.x, width: item.width, text: item.text };
        if (row && row.page === pageNumber && Math.abs(row.y - item.y) < ROW_TOLERANCE) {
          row.cells.push(cell);
        } else {
          rows.push({ page: pageNumber, y: item.y, cells: [cell], text: '' });
        }
      }
    }
    for (const row of rows) {
      row.cells.sort((a, b) => a.x - b.x);
      row.text = row.cells.map((cell) => cell.text).join(' ');
    }
    return rows;
  } finally {
    await task.destroy();
  }
}

export function parseDate(raw: string): string | undefined {
  const value = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value);
  const named = /^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/.exec(value);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    [month, day] = [Number(us[1]), Number(us[2])];
  } else if (named) {
    month = MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase()) + 1;
    [day, year] = [Number(named[2]), Number(named[3])];
  } else {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

export function parseMoney(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.match(MONEY_PATTERN)?.at(-1);
  if (!match) {
    return undefined;
  }
  const negative = match.includes('-') || match.startsWith('(');
  const value = Number(match.replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? (negative ? -value : value) : undefined;
}

const headingOf = (text: string) => HEADINGS.find(([, pattern]) => pattern.test(text.trim()))?.[0];

// Headings that nearly touch arrive merged ("RATE QUANTITY"); split them,
// estimating each one's position from the cell's width.
function headingCells(cell: Cell): Array<{ column: Column; x: number; end: number }> {
  const whole = headingOf(cell.text);
  if (whole) {
    return [{ column: whole, x: cell.x, end: cell.x + cell.width }];
  }
  const words = cell.text.split(/\s+/);
  const perChar = cell.width / Math.max(cell.text.length, 1);
  const parts: Array<{ column: Column; x: number; end: number }> = [];
  let offset = 0;
  for (let start = 0; start < words.length; ) {
    let matched = 0;
    let column: Column | undefined;
    for (let end = words.length; end > start && !column; end -= 1) {
      column = headingOf(words.slice(start, end).join(' '));
      matched = end - start;
    }
    if (!column) {
      return [];
    }
    const phrase = words.slice(start, start + matched).join(' ');
    parts.push({ column, x: cell.x + offset * perChar, end: cell.x + (offset + phrase.length) * perChar });
    offset += phrase.length + 1;
    start += matched;
  }
  return parts;
}

function headerColumns(row: Row): Columns | undefined {
  const columns: Columns = new Map();
  for (const part of row.cells.flatMap(headingCells)) {
    if (!columns.has(part.column)) {
      columns.set(part.column, { x: part.x, end: part.end });
    }
  }
  return columns.has('amount') && columns.size >= 3 ? columns : undefined;
}

// PDF.js can merge text across a column boundary ("Timekeeper A Initial
// case…"); split at the word gap nearest each boundary.
function splitAtColumns(cell: Cell, boundaries: number[]): Cell[] {
  const inside = boundaries.filter((x) => x > cell.x + COLUMN_TOLERANCE && x < cell.x + cell.width - COLUMN_TOLERANCE);
  if (inside.length === 0 || cell.text.length === 0) {
    return [cell];
  }
  const perChar = cell.width / cell.text.length;
  const boundary = inside[0]!;
  let best = -1;
  for (let index = cell.text.indexOf(' '); index >= 0; index = cell.text.indexOf(' ', index + 1)) {
    if (best < 0 || Math.abs(cell.x + index * perChar - boundary) < Math.abs(cell.x + best * perChar - boundary)) {
      best = index;
    }
  }
  if (best < 0) {
    return [cell];
  }
  const left: Cell = { x: cell.x, width: best * perChar, text: cell.text.slice(0, best).trim() };
  const right: Cell = { x: boundary, width: cell.width - (boundary - cell.x), text: cell.text.slice(best + 1).trim() };
  return [left, ...splitAtColumns(right, boundaries)].filter((part) => part.text !== '');
}

// By overlap, not left edges, because right-aligned values can start left of
// their heading.
function cellsByColumn(row: Row, columns: Columns): Map<Column, string> {
  const headings = [...columns.entries()].sort((a, b) => a[1].x - b[1].x);
  const boundaries = headings.map(([, extent]) => extent.x);
  const values = new Map<Column, string>();
  for (const cell of row.cells.flatMap((original) => splitAtColumns(original, boundaries))) {
    const start = cell.x;
    const end = cell.x + cell.width;
    let best: Column | undefined;
    let bestScore = -Infinity;
    for (const [column, extent] of headings) {
      const overlap = Math.min(end, extent.end) - Math.max(start, extent.x);
      // Positive overlap wins; otherwise the smaller gap is the better fit.
      const score = overlap >= -COLUMN_TOLERANCE ? 1000 + overlap : -Math.abs(overlap);
      if (score > bestScore) {
        best = column;
        bestScore = score;
      }
    }
    if (best) {
      values.set(best, [values.get(best), cell.text].filter(Boolean).join(' '));
    }
  }
  return values;
}

type Section = 'time' | 'expense' | undefined;

// A title on or above the heading row ("Expenses") says what items are.
function sectionOf(rows: Row[], headerIndex: number): Section {
  for (const row of rows.slice(Math.max(0, headerIndex - 2), headerIndex + 1).reverse()) {
    if (/\b(expenses?|disbursements?|costs?)\b/i.test(row.text)) {
      return 'expense';
    }
    if (/\b(time|fees|services|professional)\b/i.test(row.text)) {
      return 'time';
    }
  }
  return undefined;
}

function lineType(section: Section, hours: number | undefined, description: string, expenseCode: string | undefined): LineType {
  if (expenseCode || section === 'expense' || (hours === undefined && EXPENSE_WORDS.test(description))) {
    return 'expense';
  }
  return hours !== undefined || section === 'time' ? 'time' : 'other';
}

// A cell that is only a total label (and amount), so "Total knee…" isn't one.
const TOTAL_CELL = /^[A-Za-z\s-]*\b(sub-?)?totals?\b[A-Za-z\s-]*:?\s*(\$?\s?[\d,]+\.\d{2})?$/i;
const isTotalRow = (row: Row) =>
  /\b(amount|balance) due\b/i.test(row.text) || row.cells.some((cell) => TOTAL_CELL.test(cell.text) && /total/i.test(cell.text));

function invoiceFields(rows: Row[]): Pick<ParsedInvoice, 'invoiceNumber' | 'periodStart' | 'periodEnd' | 'statedTotal'> {
  const all = rows.map((row) => row.text);
  const invoiceNumber = all
    .map((text) => /\b(?:invoice|voucher|bill)\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]*)/i.exec(text)?.[1])
    .find(Boolean);
  const periodDates = all
    .filter((text) => /period/i.test(text))
    .flatMap((text) => [...text.matchAll(DATE_PATTERN)].map((match) => parseDate(match[1]!)))
    .filter((date): date is string => Boolean(date));
  // The invoice total is the last total that isn't a section subtotal.
  const totalRows = rows.filter(isTotalRow);
  const totalRow =
    totalRows.filter((row) => /total due|amount due|balance due|^total\b|total amount/i.test(row.text)).at(-1) ?? totalRows.at(-1);
  return {
    invoiceNumber,
    periodStart: periodDates.length >= 2 ? periodDates[0] : undefined,
    periodEnd: periodDates.length >= 2 ? periodDates[1] : undefined,
    statedTotal: totalRow ? parseMoney(totalRow.text) : undefined,
  };
}

export async function extractFromTextLayer(bytes: Buffer): Promise<ParsedInvoice> {
  const rows = await readRows(bytes);
  if (rows.length === 0) {
    throw new UnreadableInvoiceFileError('This PDF has no readable text; it may be a scan. Enter the items by hand instead.');
  }

  if (!rows.some((row) => headerColumns(row))) {
    throw new UnreadableInvoiceFileError('No table of invoice items was found in this PDF. Enter the items by hand instead.');
  }

  const lines: ParsedLine[] = [];
  // Headings start a table and a total ends it, across pages.
  let columns: Columns | undefined;
  let section: Section;
  let previous: ParsedLine | undefined;
  for (const [index, row] of rows.entries()) {
    const headings = headerColumns(row);
    if (headings) {
      columns = headings;
      section = sectionOf(rows, index);
      previous = undefined;
      continue;
    }
    if (!columns) {
      continue;
    }
    if (isTotalRow(row)) {
      columns = undefined;
      continue;
    }
    const cells = cellsByColumn(row, columns);
    const amount = parseMoney(cells.get('amount'));
    if (amount === undefined) {
      // Text-only rows continue the item above; anything else is ignored.
      const onlyText = [...cells.keys()].every((column) => column === 'description' || column === 'timekeeper');
      if (previous && onlyText) {
        const description = cells.get('description');
        const timekeeper = cells.get('timekeeper');
        // Stacked cells put the date on its own line under the item.
        const stackedDate = description && !previous.serviceDate ? parseDate(description) : undefined;
        if (stackedDate) {
          previous.serviceDate = stackedDate;
        } else if (description) {
          previous.description = `${previous.description ?? ''} ${description}`.trim();
        }
        if (timekeeper) {
          previous.timekeeperLabel = `${previous.timekeeperLabel ?? ''} ${timekeeper}`.trim();
        }
      }
      continue;
    }
    if (amount < 0) {
      throw new UnreadableInvoiceFileError('Credits and adjustments in the PDF can’t be imported; enter them with the reviewer.');
    }
    if (amount === 0) {
      previous = undefined;
      continue;
    }
    const description = (cells.get('description') ?? '').replace(/^[a-z]\.\s+/, '');
    const hoursText = cells.get('hours');
    const hours = hoursText && /^\d+(\.\d+)?$/.test(hoursText.trim()) ? Number(hoursText) : undefined;
    const taskText = optionalText(cells.get('task'));
    const expenseCode = taskText && /^E\d{3}$/i.test(taskText) ? taskText.toUpperCase() : undefined;
    // Only code-like values ("A102"); words like "Research" are categories.
    const activityText = optionalText(cells.get('activity'));
    previous = {
      location: `page ${row.page}, row ${lines.length + 1}`,
      lineType: lineType(section, hours, description, expenseCode),
      serviceDate: cells.get('date') ? parseDate(cells.get('date')!) : undefined,
      description: optionalText(description),
      timekeeperLabel: optionalText(cells.get('timekeeper')),
      quantity: hours,
      unitRate: parseMoney(cells.get('rate')),
      amount,
      taskCode: expenseCode ? undefined : taskText,
      activityCode: activityText && /^[A-Z]\d{3}$/i.test(activityText) ? activityText.toUpperCase() : undefined,
      expenseCode,
    };
    lines.push(previous);
  }
  if (lines.length === 0) {
    throw new UnreadableInvoiceFileError('No invoice items with amounts were found in this PDF. Enter the items by hand instead.');
  }
  checkLineCount(lines);
  return { ...invoiceFields(rows), lines };
}

export const textLayerExtractor: InvoiceExtractor = {
  id: 'pdf-text-layer',
  version: '1',
  inBoundary: true,
  extract: extractFromTextLayer,
};
