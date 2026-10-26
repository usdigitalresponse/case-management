// Reads a PDF's text in-process: the text layer when it has one, otherwise
// text recognition (a scan). Rebuilds rows from text positions, finds the item
// table by its headings and reads one item per row with an amount, or items
// written as sentences in a letter. Other layouts fail.
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
  // Recognized cells only: the least confident word's, and the mean.
  confidence?: number;
  meanConfidence?: number;
  words?: number;
}

// Handwriting or a poor scan is unsure throughout; print with one smudged
// word isn't.
const unclear = (cell: Cell) => (cell.meanConfidence ?? 100) < LOW_CONFIDENCE;

// Unclear text worth quoting to a reviewer, without stray symbols; mostly
// figures, or it's noise.
export function legible(text: string): string | undefined {
  const cleaned = text.replace(/[^A-Za-z0-9.,:/$%()\- ]/g, '').replace(/\s+/g, ' ').trim();
  const characters = cleaned.replace(/\s/g, '');
  const figures = characters.replace(/[^\d.,:/$%-]/g, '');
  return /\d/.test(cleaned) && figures.length >= 0.6 * characters.length ? cleaned : undefined;
}

// " (read as “42-40”, “130”)", or nothing when none of it is legible.
function quoted(cells: Cell[], label: string): string {
  const guesses = cells.map((cell) => legible(cell.text)).filter((guess): guess is string => guess !== undefined);
  return guesses.length > 0 ? ` (${label} ${guesses.map((guess) => `“${guess}”`).join(', ')})` : '';
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
// Amounts, including commas recognized as points ("2.500.00") and
// three-place rates ($0.725 a mile).
const MONEY_PATTERN = /\(?-?\$?\s?(?:\d{1,3}(?:\.\d{3})+\.\d{2}|\d[\d,]*(?:\.\d{1,3})?)\)?/g;
// A page number line ("Invoice 1209 | Page 2", "Page 2 of 5").
const PAGE_NUMBER = /\bpage\s*\d+(\s*(of|\/)\s*\d+)?\s*$/i;
const NUMERIC_CELL = /^\(?-?\$?\s?\d[\d,]*(?:\.\d+)?\)?$/;
const EXPENSE_WORDS = /\b(expenses?|fees?|costs?|mileage|travel|lodging|hotel|copies|copying|postage|filing|courier|transcripts?)\b/i;
// Items written as sentences, as in a letter: "Site visit 2 hrs x $100.00 =
// $200.00". The quantity may be misread ("Thr" for "1 hr").
const ITEM_SENTENCE = /(?:^|\s)(\S*?)\s*(?:hrs?|hours?)\.?\s*[x×]\s*(\$?\s?[\d,.]*\d)\s*=\s*[$%]*\s*([\d,.]*\d)\s*$/i;
// A numbered item ending in an amount ("6. Lodging, two nights $ 161.00").
const NUMBERED_ITEM = /^\W*\d{1,3}\.\s+.*\D\s*\$\s?([\d,]+\.\d{2})$/;
const LIST_MARKER = /^\W*\d{1,3}\.\s+/;
// "Site visit, March 9, 2026:" before a sentence's figures.
const TRAILING_DATE = new RegExp(`[\\s,:;-]*(?:${DATE_PATTERN.source})?[\\s,:;-]*$`);


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
        cell.meanConfidence = ((cell.meanConfidence ?? 100) * cell.words! + word.confidence) / (cell.words! + 1);
        cell.words! += 1;
      } else {
        cells.push({ x: word.x, width: word.width, text: word.text, confidence: word.confidence, meanConfidence: word.confidence, words: 1 });
      }
      previousEnd = word.x + word.width;
    }
    // A typical word's extent, so a tall handwritten mark on the line
    // doesn't join it to the next one.
    const bottom = median(line.map((word) => word.y));
    const top = median(line.map((word) => word.y + word.height));
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
      // The drawing operators hold the page's decoded images.
      page.cleanup();
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

// The last amount in the text, preferring one with cents, so a stray mark
// read as a digit after a total ("$1,250.00 7") isn't taken for it.
export function parseMoney(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const matches = raw.match(MONEY_PATTERN) ?? [];
  const match = matches.filter((candidate) => /\.\d{2,3}\)?$/.test(candidate)).at(-1) ?? matches.at(-1);
  if (!match) {
    return undefined;
  }
  const negative = match.includes('-') || match.startsWith('(');
  const digits = match.replace(/[^\d.]/g, '');
  const point = digits.lastIndexOf('.');
  const value = Number(point < 0 ? digits : digits.slice(0, point).replace(/\./g, '') + digits.slice(point));
  return Number.isFinite(value) ? (negative ? -value : value) : undefined;
}

type Figure = 'quantity' | 'unitRate' | 'amount';
const FIGURES: Figure[] = ['quantity', 'unitRate', 'amount'];

export interface FigureReading {
  text: string;
  // Recognition's, 0–100; absent when confident.
  confidence?: number;
}

export type Figures = Partial<Record<Figure, number>>;

const readFigure = (figure: Figure, text: string) =>
  figure === 'quantity' ? (/^\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : undefined) : parseMoney(text);

// What a recognized figure may stand for, with a cost: as read (0), a number
// among marks, or with a dropped decimal point ("89250" for 892.50) (1 each).
function figureOptions(figure: Figure, text: string): Array<{ value: number; cost: number }> {
  const read = readFigure(figure, text);
  const found = read !== undefined ? [{ value: read, cost: 0 }] : (text.match(/\d+(?:\.\d+)?/g) ?? []).map((token) => ({ value: Number(token), cost: 1 }));
  const options = [...found];
  if (!/\.\d/.test(text)) {
    for (const { value, cost } of found) {
      if (Number.isInteger(value) && value >= 10) {
        for (const divisor of figure === 'quantity' ? [10, 100] : [100]) {
          options.push({ value: value / divisor, cost: cost + 1 });
        }
      }
    }
  }
  return options.filter((option) => option.value > 0);
}

// The figure the other two make, if it is a plausible one.
function deriveFigure(figure: Figure, figures: Figures): number | undefined {
  const { quantity, unitRate, amount } = figures;
  if (figure === 'amount') {
    return quantity !== undefined && unitRate !== undefined ? cents(quantity * unitRate) / 100 : undefined;
  }
  const other = figure === 'quantity' ? unitRate : quantity;
  if (amount === undefined || other === undefined) {
    return undefined;
  }
  // Small quantities and rates can have three places (1.067 hours, $0.725
  // a mile); larger ones have two.
  const exact = amount / other;
  const places = exact < 10 ? 1000 : 100;
  const value = Math.round(exact * places) / places;
  return value > 0 && cents(value * other) === cents(amount) ? value : undefined;
}

const DERIVED_COST = 2.5;

function readFigures(read: Partial<Record<Figure, FigureReading>>): Figures {
  const figures: Figures = {};
  for (const figure of FIGURES) {
    if (read[figure]) {
      figures[figure] = readFigure(figure, read[figure]!.text);
    }
  }
  return figures;
}

// A recognized item's quantity × rate should make its amount. When it
// doesn't, the single cheapest explanation is taken: options above, else one
// unreadable or unsure figure worked out from the other two (costing more,
// so figures actually read win). No repair when nothing or several fit.
export function reconcileFigures(read: Partial<Record<Figure, FigureReading>>): { figures: Figures; repaired: Figure[] } {
  const asRead = readFigures(read);
  if (FIGURES.some((figure) => !read[figure]?.text.trim())) {
    return { figures: asRead, repaired: [] };
  }
  const options = FIGURES.map((figure) => figureOptions(figure, read[figure]!.text));
  const fits: Array<{ figures: Figures; cost: number }> = [];
  for (const quantity of options[0]!) {
    for (const unitRate of options[1]!) {
      for (const amount of options[2]!) {
        if (cents(quantity.value * unitRate.value) === cents(amount.value)) {
          fits.push({ figures: { quantity: quantity.value, unitRate: unitRate.value, amount: amount.value }, cost: quantity.cost + unitRate.cost + amount.cost });
        }
      }
    }
  }
  for (const figure of FIGURES) {
    if (asRead[figure] !== undefined && (read[figure]!.confidence ?? 100) >= LOW_CONFIDENCE) {
      continue;
    }
    const [first, second] = FIGURES.filter((other) => other !== figure);
    const otherOptions = (other: Figure) => options[FIGURES.indexOf(other)]!.filter((option) => option.cost === 0);
    for (const a of otherOptions(first!)) {
      for (const b of otherOptions(second!)) {
        const value = deriveFigure(figure, { [first!]: a.value, [second!]: b.value });
        if (value !== undefined) {
          fits.push({ figures: { [first!]: a.value, [second!]: b.value, [figure]: value }, cost: DERIVED_COST });
        }
      }
    }
  }
  const cheapest = Math.min(...fits.map((fit) => fit.cost));
  if (cheapest === 0 || cheapest > DERIVED_COST) {
    return { figures: asRead, repaired: [] };
  }
  const best = [...new Map(fits.filter((fit) => fit.cost === cheapest).map((fit) => [FIGURES.map((figure) => cents(fit.figures[figure]!)).join(), fit])).values()];
  if (best.length !== 1) {
    return { figures: asRead, repaired: [] };
  }
  const figures = best[0]!.figures;
  return { figures, repaired: FIGURES.filter((figure) => figures[figure] !== asRead[figure]) };
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
// neighbouring figure column, and with no quantity heading (or nothing under
// it) the first of two figures under the rate is the quantity.
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
  // A short quantity ("1") right-aligned past its heading lands nearer the
  // rate's.
  const rates = values.get('rate');
  if (!values.has('hours') && rates && rates.length === 2 && rates.every((cell) => NUMERIC_CELL.test(cell.text))) {
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

// An item written as a sentence; numbered items with only an amount count
// once sentences with hours have been found, so a numbered note before the
// items isn't taken for one.
function itemSentence(text: string, afterItems: boolean): { description: string; quantity?: string; rate?: string; amount: string } | undefined {
  const sentence = ITEM_SENTENCE.exec(text);
  if (sentence) {
    return { description: text.slice(0, sentence.index).trim(), quantity: sentence[1], rate: sentence[2], amount: sentence[3]! };
  }
  const numbered = afterItems && !/\btotal\b/i.test(text) ? NUMBERED_ITEM.exec(text) : null;
  return numbered ? { description: numbered[0].replace(/\$\s?[\d,]+\.\d{2}$/, '').trim(), amount: numbered[1]! } : undefined;
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

  if (!rows.some((row) => headerColumns(row) || ITEM_SENTENCE.test(row.text))) {
    throw new UnreadableInvoiceFileError('No table of invoice items was found in this PDF. Enter the items by hand instead.');
  }

  const warnings: ImportWarning[] = [];
  if (recognized) {
    warnings.push({
      code: 'read_by_ocr',
      message: 'This PDF is a scan or its text couldn’t be used, so the text was recognized from the page images. Check every value against the file.',
    });
  }
  const lines: ParsedLine[] = [];
  // Only recognized figures are repaired; digital text is taken as written,
  // so its own errors still show as rate mismatches.
  const settle = (read: Partial<Record<Figure, FigureReading>>, location: string): Figures => {
    const { figures, repaired } = recognized ? reconcileFigures(read) : { figures: readFigures(read), repaired: [] };
    if (repaired.length > 0 && figures.amount !== undefined) {
      const how = { quantity: 'Quantity worked out from amount ÷ rate', unitRate: 'Rate worked out from amount ÷ quantity', amount: 'Amount worked out from quantity × rate' };
      const names = repaired.map((figure) => (figure === 'unitRate' ? 'rate' : figure));
      warnings.push({
        code: 'figures_repaired',
        location,
        message: `${repaired.length === 1 ? how[repaired[0]!] : `${names.join(' and ').replace(/^./, (first) => first.toUpperCase())} adjusted so quantity × rate makes the amount`}, since the scan’s figures didn’t add up. Compare with the file.`,
      });
    }
    return figures;
  };
  // Headings start a table and a total ends it, across pages. After an
  // amount due, a table on a later page is an attachment (a receipt), so
  // reading stops there; one on the same page, such as expenses after a
  // "total due for services", is still the invoice's. Outside tables, items
  // written as sentences are read, and a total after the last of them ends
  // the invoice the same way.
  let columns: Columns | undefined;
  let section: Section;
  let previous: ParsedLine | undefined;
  let sinceSubtotal = 0;
  let dueOnPage: number | undefined;
  let sentenceItems = 0;
  let totalAfterSentences = false;
  // A numbered row without figures, which the next item sentence describes.
  let listText: string | undefined;
  let lastRow = rows.length - 1;
  // Unclear text or marks (handwriting, a correction or a poor scan) never
  // change the printed figures; one warning per item (or page) quotes them.
  const unclearNotes = new Map<string, { warning: ImportWarning; guesses: string[] }>();
  const noteUnclear = (page: number, cells: Cell[]) => {
    const withFigures = cells.filter((cell) => /\d/.test(cell.text));
    if (withFigures.length === 0) {
      return;
    }
    const target = previous?.location.startsWith(`page ${page},`) ? previous : undefined;
    const location = target?.location ?? `page ${page}`;
    let note = unclearNotes.get(location);
    if (!note) {
      note = { warning: { code: 'unclear_text', location, message: '' }, guesses: [] };
      unclearNotes.set(location, note);
      warnings.push(note.warning);
    }
    note.guesses.push(...withFigures.map((cell) => legible(cell.text)).filter((guess): guess is string => guess !== undefined));
    const where = target ? 'near this item' : `on page ${page}`;
    note.warning.message =
      note.guesses.length === 0
        ? `Unclear text or marks ${where} that couldn’t be read. Compare with the file.`
        : `Unclear text or marks ${where} (best guess: ${note.guesses.map((guess) => `“${guess}”`).join(', ')}). ${
            target ? 'The printed figures were imported; compare with the file.' : 'Check whether it affects an item.'
          }`;
  };
  for (const [index, row] of rows.entries()) {
    const headings = headerColumns(row);
    if (headings) {
      if ((dueOnPage !== undefined && row.page > dueOnPage) || totalAfterSentences) {
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
      const sentence = itemSentence(row.text, sentenceItems > 0);
      if (sentence) {
        const location = `page ${row.page}, row ${lines.length + 1}`;
        const { quantity, unitRate, amount } = settle(
          {
            quantity: sentence.quantity === undefined ? undefined : { text: sentence.quantity },
            unitRate: sentence.rate === undefined ? undefined : { text: sentence.rate },
            amount: { text: sentence.amount },
          },
          location,
        );
        if (amount !== undefined && amount > 0) {
          const ownText = sentence.description.replace(LIST_MARKER, '');
          const text = LIST_MARKER.test(sentence.description) || !listText ? ownText : `${listText.replace(LIST_MARKER, '')} ${ownText}`.trim();
          const description = text.replace(TRAILING_DATE, '');
          lines.push({
            location,
            lineType: lineType(undefined, quantity, description, undefined),
            serviceDate: [...text.matchAll(DATE_PATTERN)].map((match) => parseDate(match[1]!)).find(Boolean),
            description: optionalText(description),
            quantity,
            unitRate,
            amount,
          });
          sentenceItems += 1;
          totalAfterSentences = false;
          listText = undefined;
        }
      } else if (sentenceItems > 0 && isTotalRow(row) && !isSubtotalRow(row)) {
        totalAfterSentences = true;
      } else if (LIST_MARKER.test(row.text)) {
        listText = row.text;
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
    if (row.cells.some((cell) => SUMMARY_CELL.test(cell.text)) || PAGE_NUMBER.test(row.text)) {
      continue;
    }
    // A recognized row read entirely without confidence is unclear text or
    // marks (a note in the margin), not a printed item.
    if (recognized && row.cells.every(unclear)) {
      noteUnclear(row.page, row.cells);
      continue;
    }
    const cells = cellsByColumn(row, columns);
    const location = `page ${row.page}, row ${lines.length + 1}`;
    const reading = (column: Column): FigureReading | undefined => {
      const found = cells.get(column);
      return found && { text: textOf(found)!, confidence: Math.min(...found.map((cell) => cell.confidence ?? 100)) };
    };
    const { quantity: hours, unitRate, amount } = settle({ quantity: reading('hours'), unitRate: reading('rate'), amount: reading('amount') }, location);
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
    if (amount < 0) {
      if (!recognized) {
        throw new UnreadableInvoiceFileError('Credits and adjustments in the PDF can’t be imported; enter them with the reviewer.');
      }
      // An unsure minus is likely a correction ("-40"); a confident one is
      // printed text with a dash ("pages 1-40") continuing the item above.
      const marks = NUMERIC_COLUMNS.flatMap((column) => cells.get(column) ?? []).filter(unclear);
      if (marks.length > 0) {
        noteUnclear(row.page, marks);
      } else if (previous) {
        previous.description = `${previous.description ?? ''} ${row.text}`.trim();
      }
      continue;
    }
    if (amount === 0) {
      previous = undefined;
      continue;
    }
    // Without letter ("a.") or number ("7.") list markers.
    const description = (textOf(cells.get('description')) ?? '').replace(/^([a-z]|\d{1,3})\.\s+/, '');
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
      unitRate,
      amount,
      taskCode: expenseCode ? undefined : taskText,
      activityCode: activityText && /^[A-Z]\d{3}$/i.test(activityText) ? activityText.toUpperCase() : undefined,
      expenseCode,
    };
    const unsure = recognized
      ? NUMERIC_COLUMNS.flatMap((column) => cells.get(column) ?? []).filter((cell) => (cell.confidence ?? 100) < LOW_CONFIDENCE)
      : [];
    if (unsure.length > 0) {
      warnings.push({
        code: 'low_confidence',
        location,
        message: `Figures unclear on the scan${quoted(unsure, 'read as')}. Compare with the file.`,
      });
    }
    lines.push(previous);
    sinceSubtotal += cents(amount);
  }
  // Nothing on a page after the amount due is the invoice's, so an attached
  // receipt's total isn't taken for its total.
  const invoiceRows = rows.slice(0, lastRow + 1).filter((row) => dueOnPage === undefined || row.page <= dueOnPage);
  if (lines.length === 0) {
    throw new UnreadableInvoiceFileError('No invoice items with amounts were found in this PDF. Enter the items by hand instead.');
  }
  checkLineCount(lines);
  return { ...invoiceFields(invoiceRows), lines, warnings };
}

export const textLayerExtractor: InvoiceExtractor = {
  id: 'pdf-text-layer',
  version: '2',
  inBoundary: true,
  extract: extractFromTextLayer,
};
