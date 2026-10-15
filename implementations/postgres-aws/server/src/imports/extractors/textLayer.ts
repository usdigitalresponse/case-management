// Reads a PDF's text in-process: the text layer when it has one, otherwise
// text recognition (a scan). Rebuilds rows from text positions, finds the item
// table by its headings and reads one item per row with an amount. Layouts
// without an item table fail.
import type { LineType } from '../../billing/invoiceLifecycle';
import {
  cents,
  checkLineCount,
  optionalText,
  UnreadableInvoiceFileError,
  type ImportWarning,
  type ParsedInvoice,
  type ParsedLine,
} from '../parsedInvoice';
import { recognizePages, type OcrWord } from './ocr';
import { loadPdfJs, withPdf, type PdfPage, type PdfTextItem } from './pdfDocument';
import type { ExtractOptions, InvoiceExtractor } from './types';

// In points.
const ROW_TOLERANCE = 2;
const COLUMN_TOLERANCE = 2;
// Recognized figures below this Tesseract confidence (0–100) are flagged.
const LOW_CONFIDENCE = 70;

interface Cell {
  x: number;
  width: number;
  text: string;
  // Recognized cells only.
  confidence?: number;
}

interface Row {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

type Column = 'date' | 'timekeeper' | 'description' | 'hours' | 'rate' | 'amount' | 'task' | 'activity';

const NUMERIC_COLUMNS: Column[] = ['hours', 'rate', 'amount'];

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
const DATE_PATTERN = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]{3,9}\.? \d{1,2}, \d{4})/g;
const LEADING_DATE = /^\W*(?:\d{1,3}\.\s+)?(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]{3,9}\.? \d{1,2}, \d{4})(?!\d)/;
const MONEY_PATTERN = /\(?-?\$?\s?\d[\d,]*(?:\.\d{1,2})?\)?/g;
const NUMERIC_CELL = /^\(?-?\$?\s?\d[\d,]*(?:\.\d+)?\)?$/;
const EXPENSE_WORDS = /\b(expenses?|fees?|costs?|mileage|travel|copies|copying|postage|filing|courier|transcripts?)\b/i;


function finishRows(rows: Row[]): Row[] {
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    row.text = row.cells.map((cell) => cell.text).join(' ');
  }
  return rows;
}

// Recognized words become cells like text-layer runs: words closer than
// about half their height join. Lines that overlap vertically share a row, because
// Tesseract often reads each table column as its own line.
function recognizedRows(page: number, words: OcrWord[]): Row[] {
  const lines = new Map<number, OcrWord[]>();
  for (const word of words) {
    lines.set(word.line, [...(lines.get(word.line) ?? []), word]);
  }
  const rows: Array<Row & { top: number; bottom: number }> = [];
  const byTop = [...lines.values()].sort((a, b) => Math.max(...b.map((w) => w.y + w.height)) - Math.max(...a.map((w) => w.y + w.height)));
  for (const line of byTop) {
    line.sort((a, b) => a.x - b.x);
    const height = median(line.map((word) => word.height));
    const cells: Cell[] = [];
    let previousEnd = -Infinity;
    for (const word of line) {
      const cell = cells[cells.length - 1];
      if (cell && word.x - previousEnd < height * 0.6) {
        cell.text = `${cell.text} ${word.text}`;
        cell.width = word.x + word.width - cell.x;
        cell.confidence = Math.min(cell.confidence ?? 100, word.confidence);
      } else {
        cells.push({ x: word.x, width: word.width, text: word.text, confidence: word.confidence });
      }
      previousEnd = word.x + word.width;
    }
    const bottom = Math.min(...line.map((word) => word.y));
    const top = Math.max(...line.map((word) => word.y + word.height));
    const row = rows.find((candidate) => Math.min(top, candidate.top) - Math.max(bottom, candidate.bottom) >= 0.5 * Math.min(top - bottom, candidate.top - candidate.bottom));
    if (row) {
      row.cells.push(...cells);
      row.top = Math.max(row.top, top);
      row.bottom = Math.min(row.bottom, bottom);
    } else {
      rows.push({ page, y: bottom, top, bottom, cells, text: '' });
    }
  }
  return finishRows(rows.sort((a, b) => b.y - a.y));
}

// Text a font can't map to characters arrives as control, private-use or
// replacement characters; a layer that is mostly those isn't usable.
const UNMAPPED = /[\u0000-\u0008\u000e-\u001f-�]/gu;

export function textLooksGarbled(text: string): boolean {
  const characters = text.replace(/\s/g, '');
  return characters.length > 0 && (characters.match(UNMAPPED)?.length ?? 0) / characters.length > 0.2;
}

// A searchable scan: page images under invisible text (rendering mode 3 or
// 7) that the scanner's own recognition added.
async function drawsOnlyHiddenText(page: PdfPage, OPS: Record<string, number>): Promise<boolean> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const shows = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
  const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
  const saved: number[] = [];
  let mode = 0;
  let hidden = 0;
  let painted = false;
  for (const [index, op] of fnArray.entries()) {
    if (op === OPS.save) {
      saved.push(mode);
    } else if (op === OPS.restore) {
      mode = saved.pop() ?? 0;
    } else if (op === OPS.setTextRenderingMode) {
      mode = Number(argsArray[index]?.[0] ?? 0);
    } else if (shows.has(op)) {
      if (mode !== 3 && mode !== 7) {
        return false;
      }
      hidden += 1;
    } else if (images.has(op)) {
      painted = true;
    }
  }
  return painted && hidden > 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function readRows(bytes: Buffer, options: ExtractOptions): Promise<{ rows: Row[]; recognized: boolean }> {
  const { OPS } = loadPdfJs();
  options.onProgress?.({ stage: 'reading' });
  return withPdf(bytes, async (document) => {
    const rows: Row[] = [];
    const hiddenTextPages = new Set<number>();
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await document.getPage(pageNumber);
      // eslint-disable-next-line no-await-in-loop
      const content = await page.getTextContent();
      const pageItems = content.items.filter((item): item is PdfTextItem => 'str' in item && item.str.trim() !== '');
      // eslint-disable-next-line no-await-in-loop
      if (pageItems.length > 0 && (await drawsOnlyHiddenText(page, OPS))) {
        hiddenTextPages.add(pageNumber);
      }
      const items = pageItems
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
    // A file with visible, readable text is read from its text layer; mixed
    // files keep that only, so scanned attachments behind a digital invoice
    // aren't read as items. Scans, including searchable ones whose hidden
    // text another program recognized, and unusable text layers are
    // recognized here instead.
    const visibleRows = rows.filter((row) => !hiddenTextPages.has(row.page));
    if (visibleRows.length > 0 && !textLooksGarbled(visibleRows.map((row) => row.cells.map((cell) => cell.text).join(' ')).join('\n'))) {
      return { rows: finishRows(visibleRows), recognized: false };
    }
    const pageNumbers = Array.from({ length: document.numPages }, (_, index) => index + 1);
    const recognized = await recognizePages(document, pageNumbers, (page, pages) =>
      options.onProgress?.({ stage: 'recognizing', page, pages }),
    );
    return { rows: pageNumbers.flatMap((page) => recognizedRows(page, recognized.get(page) ?? [])), recognized: true };
  });
}

export function parseDate(raw: string): string | undefined {
  const value = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})([/-])(\d{1,2})\2(\d{2,4})$/.exec(value);
  const named = /^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/.exec(value);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    year = Number(us[4]) < 100 ? 2000 + Number(us[4]) : Number(us[4]);
    [month, day] = [Number(us[1]), Number(us[3])];
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
  const left: Cell = { ...cell, width: best * perChar, text: cell.text.slice(0, best).trim() };
  const right: Cell = { ...cell, x: boundary, width: cell.width - (boundary - cell.x), text: cell.text.slice(best + 1).trim() };
  return [left, ...splitAtColumns(right, boundaries)].filter((part) => part.text !== '');
}

// By overlap, not left edges, because right-aligned values can start left of
// their heading. Text under no heading goes to the description rather than a
// neighbouring figure column, and with no quantity heading the first of two
// figures under the rate is the quantity.
function cellsByColumn(row: Row, columns: Columns): Map<Column, Cell[]> {
  const headings = [...columns.entries()].sort((a, b) => a[1].x - b[1].x);
  const boundaries = headings.map(([, extent]) => extent.x);
  const tableEnd = Math.max(...headings.map(([, extent]) => extent.end));
  const values = new Map<Column, Cell[]>();
  for (const cell of row.cells.flatMap((original) => splitAtColumns(original, boundaries))) {
    // Words past the last column, such as ticks and margin notes.
    if (cell.x > tableEnd + COLUMN_TOLERANCE && !NUMERIC_CELL.test(cell.text)) {
      continue;
    }
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
    if (best && bestScore < 1000 && NUMERIC_COLUMNS.includes(best) && !NUMERIC_CELL.test(cell.text) && columns.has('description')) {
      best = 'description';
    }
    if (best) {
      values.set(best, [...(values.get(best) ?? []), cell]);
    }
  }
  const rates = values.get('rate');
  if (!columns.has('hours') && rates && rates.length === 2 && rates.every((cell) => NUMERIC_CELL.test(cell.text))) {
    values.set('hours', [rates[0]!]);
    values.set('rate', [rates[1]!]);
  }
  return values;
}

const textOf = (cells: Cell[] | undefined) => cells?.map((cell) => cell.text).join(' ');

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

// Mileage is an expense even when its miles are in the quantity column.
export function lineType(section: Section, hours: number | undefined, description: string, expenseCode: string | undefined): LineType {
  if (expenseCode || section === 'expense' || /\bmileage\b/i.test(description) || (hours === undefined && EXPENSE_WORDS.test(description))) {
    return 'expense';
  }
  return hours !== undefined || section === 'time' ? 'time' : 'other';
}

// A cell that is only a total label (and amount), so "Total knee…" isn't one.
const TOTAL_CELL = /^[A-Za-z\s-]*\b(sub-?)?totals?\b[A-Za-z\s-]*:?\s*(\$?\s?[\d,]+\.\d{2})?$/i;
const DUE = /\b(amount|balance|total) due\b/i;
const isTotalRow = (row: Row) => DUE.test(row.text) || row.cells.some((cell) => TOTAL_CELL.test(cell.text) && /total/i.test(cell.text));
// Page and section subtotals; the table continues after them.
const isSubtotalRow = (row: Row) => !DUE.test(row.text) && row.cells.some((cell) => TOTAL_CELL.test(cell.text) && /\bsub-?totals?\b/i.test(cell.text));
// Summary figures between a subtotal and the total.
const SUMMARY_CELL = /^((sales )?tax|amount paid|payments?( received)?|paid)\s*:?\s*(\$?\s?[\d,]+\.\d{2})?$/i;

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


export async function extractFromTextLayer(bytes: Buffer, options: ExtractOptions = {}): Promise<ParsedInvoice> {
  const { rows, recognized } = await readRows(bytes, options);
  if (rows.length === 0) {
    throw new UnreadableInvoiceFileError('No text could be read from this PDF. Enter the items by hand instead.');
  }

  if (!rows.some((row) => headerColumns(row))) {
    throw new UnreadableInvoiceFileError('No table of invoice items was found in this PDF. Enter the items by hand instead.', {
      statedTotal: invoiceFields(rows).statedTotal,
      recognized,
    });
  }

  const warnings: ImportWarning[] = [];
  if (recognized) {
    warnings.push({
      code: 'read_by_ocr',
      message: 'This PDF is a scan or its text couldn’t be used, so the text was recognized from the page images. Check every value against the file.',
    });
  }
  const lines: ParsedLine[] = [];
  // Headings start a table and a total ends it, across pages. After an
  // amount due, a table on a later page is an attachment (a receipt), so
  // reading stops there; one on the same page, such as expenses after a
  // "total due for services", is still the invoice's.
  let columns: Columns | undefined;
  let section: Section;
  let previous: ParsedLine | undefined;
  let sinceSubtotal = 0;
  let dueOnPage: number | undefined;
  let lastRow = rows.length - 1;
  for (const [index, row] of rows.entries()) {
    const headings = headerColumns(row);
    if (headings) {
      if (dueOnPage !== undefined && row.page > dueOnPage) {
        lastRow = index - 1;
        break;
      }
      // Headings repeated on a new page continue the table and its subtotal.
      columns = headings;
      section = sectionOf(rows, index);
      previous = undefined;
      continue;
    }
    if (!columns) {
      if (lines.length > 0 && DUE.test(row.text)) {
        dueOnPage = row.page;
      }
      continue;
    }
    if (isSubtotalRow(row)) {
      const stated = parseMoney(row.text);
      if (stated !== undefined && sinceSubtotal > 0 && cents(stated) !== sinceSubtotal) {
        warnings.push({
          code: 'subtotal_mismatch',
          location: `page ${row.page}`,
          message: `The subtotal on page ${row.page} is ${stated.toFixed(2)}, but the items above it add up to ${(sinceSubtotal / 100).toFixed(2)}.`,
        });
      }
      sinceSubtotal = 0;
      previous = undefined;
      continue;
    }
    if (isTotalRow(row)) {
      columns = undefined;
      sinceSubtotal = 0;
      if (lines.length > 0 && DUE.test(row.text)) {
        dueOnPage = row.page;
      }
      continue;
    }
    if (row.cells.some((cell) => SUMMARY_CELL.test(cell.text))) {
      continue;
    }
    const cells = cellsByColumn(row, columns);
    const amount = parseMoney(textOf(cells.get('amount')));
    if (amount === undefined) {
      // Text-only rows continue the item above; anything else is ignored.
      const onlyText = [...cells.keys()].every((column) => column === 'description' || column === 'timekeeper');
      if (previous && onlyText) {
        const description = textOf(cells.get('description'));
        const timekeeper = textOf(cells.get('timekeeper'));
        // Stacked cells put the date on its own line under the item.
        const stackedDate = description && !previous.serviceDate ? parseDate(description.replace(/^\W+/, '')) : undefined;
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
    const location = `page ${row.page}, row ${lines.length + 1}`;
    if (amount < 0) {
      // A recognized minus is as likely a mark on the page as a credit.
      if (!recognized) {
        throw new UnreadableInvoiceFileError('Credits and adjustments in the PDF can’t be imported; enter them with the reviewer.');
      }
      warnings.push({ code: 'line_not_read', location, message: `An amount on page ${row.page} couldn’t be read; add that item by hand.` });
      previous = undefined;
      continue;
    }
    if (amount === 0) {
      previous = undefined;
      continue;
    }
    // Without letter ("a.") or number ("7.") list markers.
    const description = (textOf(cells.get('description')) ?? '').replace(/^([a-z]|\d{1,3})\.\s+/, '');
    const hoursText = textOf(cells.get('hours'));
    const hours = hoursText && /^\d+(\.\d+)?$/.test(hoursText.trim()) ? Number(hoursText) : undefined;
    const taskText = optionalText(textOf(cells.get('task')));
    const expenseCode = taskText && /^E\d{3}$/i.test(taskText) ? taskText.toUpperCase() : undefined;
    // Only code-like values ("A102"); words like "Research" are categories.
    const activityText = optionalText(textOf(cells.get('activity')));
    const dateText = textOf(cells.get('date'));
    previous = {
      location,
      lineType: lineType(section, hours, description, expenseCode),
      // Without a date column, a date opening a description cell is the item's.
      serviceDate: dateText
        ? parseDate(dateText)
        : columns.has('date')
          ? undefined
          : (cells.get('description') ?? []).map((cell) => parseDate(LEADING_DATE.exec(cell.text)?.[1] ?? '')).find(Boolean),
      description: optionalText(description),
      timekeeperLabel: optionalText(textOf(cells.get('timekeeper'))),
      quantity: hours,
      unitRate: parseMoney(textOf(cells.get('rate'))),
      amount,
      taskCode: expenseCode ? undefined : taskText,
      activityCode: activityText && /^[A-Z]\d{3}$/i.test(activityText) ? activityText.toUpperCase() : undefined,
      expenseCode,
    };
    if (recognized && NUMERIC_COLUMNS.some((column) => (cells.get(column) ?? []).some((cell) => (cell.confidence ?? 100) < LOW_CONFIDENCE))) {
      warnings.push({
        code: 'low_confidence',
        location,
        message: 'Text recognition was unsure of this item’s figures (handwriting or marks can cause this); check them against the file.',
      });
    }
    lines.push(previous);
    sinceSubtotal += cents(amount);
  }
  if (lines.length === 0) {
    throw new UnreadableInvoiceFileError('No invoice items with amounts were found in this PDF. Enter the items by hand instead.', {
      statedTotal: invoiceFields(rows.slice(0, lastRow + 1)).statedTotal,
      recognized,
    });
  }
  checkLineCount(lines);
  return { ...invoiceFields(rows.slice(0, lastRow + 1)), lines, warnings };
}

export const textLayerExtractor: InvoiceExtractor = {
  id: 'pdf-text-layer',
  version: '2',
  inBoundary: true,
  extract: extractFromTextLayer,
};
