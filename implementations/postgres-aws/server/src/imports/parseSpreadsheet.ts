// The invoice template as CSV or XLSX: a header row naming these columns in
// any order, then one row per item.
import { readSheet } from 'read-excel-file/node';
import {
  checkLineCount,
  optionalText,
  parseAmount,
  UnreadableInvoiceFileError,
  type ParsedInvoice,
  type ParsedLine,
} from './parsedInvoice';
import type { LineType } from '../billing/invoiceLifecycle';

export const TEMPLATE_COLUMNS = [
  'invoice_number',
  'date',
  'type',
  'timekeeper',
  'description',
  'hours',
  'rate',
  'amount',
  'task_code',
  'activity_code',
  'expense_code',
] as const;

type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];
type Cell = string | number | boolean | Date | null | undefined;

function normalizeHeader(value: Cell): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

export function looksLikeTemplateHeader(firstRow: Cell[]): boolean {
  const headers = firstRow.map(normalizeHeader);
  return headers.includes('amount') && headers.every((header) => header === '' || (TEMPLATE_COLUMNS as readonly string[]).includes(header));
}

function templateDate(value: Cell, location: string): string | undefined {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = optionalText(value);
  if (!text) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw new UnreadableInvoiceFileError(`${location}: date "${text}" must be YYYY-MM-DD.`);
  }
  return text;
}

function lineType(value: Cell, hours: number | undefined, expenseCode: string | undefined, location: string): LineType {
  const text = optionalText(value)?.toLowerCase();
  if (text === 'time' || text === 'expense' || text === 'other') {
    return text;
  }
  if (text) {
    throw new UnreadableInvoiceFileError(`${location}: type "${text}" must be time, expense or other.`);
  }
  // Unstated: guessed, for the submitter to confirm.
  return hours !== undefined ? 'time' : expenseCode ? 'expense' : 'other';
}

function parseRows(rows: Cell[][]): ParsedInvoice {
  const [header, ...body] = rows;
  if (!header || !looksLikeTemplateHeader(header)) {
    throw new UnreadableInvoiceFileError(
      `The first row must name the template columns (${TEMPLATE_COLUMNS.join(', ')}); "amount" is required.`,
    );
  }
  const columns = header.map(normalizeHeader);
  const items = body
    .map((cells, index) => ({ cells, location: `row ${index + 2}` }))
    .filter(({ cells }) => cells.some((cell) => optionalText(cell) !== undefined));
  checkLineCount(items);

  const parsed = items.map(({ cells, location }) => {
    const get = (column: TemplateColumn): Cell => cells[columns.indexOf(column)];
    const amount = parseAmount(get('amount') as string | number, location, 'amount');
    if (amount === undefined || amount <= 0) {
      throw new UnreadableInvoiceFileError(`${location}: amount must be above zero.`);
    }
    const quantity = parseAmount(get('hours') as string | number, location, 'hours');
    const expenseCode = optionalText(get('expense_code'));
    const line: ParsedLine = {
      location,
      lineType: lineType(get('type'), quantity, expenseCode, location),
      serviceDate: templateDate(get('date'), location),
      description: optionalText(get('description')),
      timekeeperLabel: optionalText(get('timekeeper')),
      quantity,
      unitRate: parseAmount(get('rate') as string | number, location, 'rate'),
      amount,
      taskCode: optionalText(get('task_code')),
      activityCode: optionalText(get('activity_code')),
      expenseCode,
    };
    return { line, invoiceNumber: optionalText(get('invoice_number')) };
  });

  const invoiceNumbers = new Set(parsed.flatMap((row) => (row.invoiceNumber ? [row.invoiceNumber] : [])));
  if (invoiceNumbers.size > 1) {
    throw new UnreadableInvoiceFileError('The file contains more than one invoice number; upload one invoice at a time.');
  }
  return { invoiceNumber: [...invoiceNumbers][0], lines: parsed.map((row) => row.line) };
}

// RFC 4180: comma-separated, double-quoted fields may contain commas,
// newlines and doubled quotes.
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) {
    throw new UnreadableInvoiceFileError('The CSV file has an unclosed quote.');
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseTemplateCsv(text: string): ParsedInvoice {
  return parseRows(parseCsvRows(text));
}

export async function parseTemplateXlsx(bytes: Buffer): Promise<ParsedInvoice> {
  let rows: Cell[][];
  try {
    rows = (await readSheet(bytes)) as unknown as Cell[][];
  } catch {
    throw new UnreadableInvoiceFileError('The spreadsheet could not be read.');
  }
  return parseRows(rows);
}
