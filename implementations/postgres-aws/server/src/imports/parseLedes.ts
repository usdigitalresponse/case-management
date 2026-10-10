// LEDES 1998B: "LEDES1998B[]", a "|"-separated header record, then one
// record per item, each ending "[]". Fields are read by name.
import {
  checkLineCount,
  optionalText,
  parseAmount,
  UnreadableInvoiceFileError,
  type ParsedInvoice,
  type ParsedLine,
} from './parsedInvoice';
import type { LineType } from '../billing/invoiceLifecycle';

export const LEDES_1998B_SIGNATURE = 'LEDES1998B';

const REQUIRED_FIELDS = ['INVOICE_NUMBER', 'EXP/FEE/INV_ADJ_TYPE', 'LINE_ITEM_TOTAL'];

// F = fee (time), E = expense; IF/IE are invoice-level adjustments.
const LINE_TYPES: Record<string, LineType> = { F: 'time', E: 'expense', IF: 'other', IE: 'other' };

function ledesDate(raw: string | undefined, location: string, field: string): string | undefined {
  const value = optionalText(raw);
  if (!value) {
    return undefined;
  }
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const iso = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  if (!match || Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new UnreadableInvoiceFileError(`${location}: ${field} "${value}" is not a YYYYMMDD date.`);
  }
  return iso;
}

export function parseLedes1998b(text: string): ParsedInvoice {
  const records = text
    .replace(/^﻿/, '')
    .split('[]')
    .map((record) => record.replace(/^[\r\n]+|[\r\n]+$/g, ''))
    .filter((record) => record.trim() !== '');
  const [signature, header, ...rows] = records;
  if (signature?.trim() !== LEDES_1998B_SIGNATURE || !header) {
    throw new UnreadableInvoiceFileError('This is not a LEDES 1998B file.');
  }
  const fields = header.split('|').map((name) => name.trim().toUpperCase());
  const missing = REQUIRED_FIELDS.filter((name) => !fields.includes(name));
  if (missing.length > 0) {
    throw new UnreadableInvoiceFileError(`The LEDES header is missing ${missing.join(', ')}.`);
  }
  checkLineCount(rows);

  const values = rows.map((row, index) => {
    const cells = row.split('|');
    // Record 1 is the signature and 2 the header, so items start at line 3.
    const location = `line ${index + 3}`;
    if (cells.length !== fields.length) {
      throw new UnreadableInvoiceFileError(`${location} has ${cells.length} fields; the header has ${fields.length}.`);
    }
    return { location, get: (name: string) => optionalText(cells[fields.indexOf(name)]) };
  });

  const invoiceNumbers = new Set(values.map((row) => row.get('INVOICE_NUMBER')));
  if (invoiceNumbers.size !== 1) {
    throw new UnreadableInvoiceFileError('The file contains more than one invoice; upload one invoice at a time.');
  }

  const lines: ParsedLine[] = values.map(({ location, get }) => {
    const typeCode = get('EXP/FEE/INV_ADJ_TYPE')?.toUpperCase() ?? '';
    const lineType = LINE_TYPES[typeCode];
    if (!lineType) {
      throw new UnreadableInvoiceFileError(`${location}: unknown item type "${typeCode}".`);
    }
    const amount = parseAmount(get('LINE_ITEM_TOTAL'), location, 'LINE_ITEM_TOTAL');
    if (amount === undefined || amount <= 0) {
      throw new UnreadableInvoiceFileError(
        `${location}: only items with a positive total can be imported; enter credits and adjustments with the reviewer.`,
      );
    }
    return {
      location,
      lineType,
      serviceDate: ledesDate(get('LINE_ITEM_DATE'), location, 'LINE_ITEM_DATE'),
      description: get('LINE_ITEM_DESCRIPTION'),
      timekeeperLabel: get('TIMEKEEPER_NAME') ?? get('TIMEKEEPER_ID'),
      quantity: parseAmount(get('LINE_ITEM_NUMBER_OF_UNITS'), location, 'LINE_ITEM_NUMBER_OF_UNITS'),
      unitRate: parseAmount(get('LINE_ITEM_UNIT_COST'), location, 'LINE_ITEM_UNIT_COST'),
      amount,
      taskCode: get('LINE_ITEM_TASK_CODE'),
      activityCode: get('LINE_ITEM_ACTIVITY_CODE'),
      expenseCode: get('LINE_ITEM_EXPENSE_CODE'),
    };
  });

  const first = values[0];
  return {
    invoiceNumber: first?.get('INVOICE_NUMBER'),
    periodStart: ledesDate(first?.get('BILLING_START_DATE'), 'line 3', 'BILLING_START_DATE'),
    periodEnd: ledesDate(first?.get('BILLING_END_DATE'), 'line 3', 'BILLING_END_DATE'),
    statedTotal: parseAmount(first?.get('INVOICE_TOTAL'), 'line 3', 'INVOICE_TOTAL'),
    lines,
  };
}
