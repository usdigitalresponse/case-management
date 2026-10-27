// A request's lines beside its file as read (server/src/imports/invoiceFile.ts):
// which lines the submitter changed, and which they removed. Removed lines
// are file lines with no current line, so they stay in view and need no
// decision.
import type { FileLine, InvoiceLineType } from './api/client';

export type ChangedField = 'date' | 'description' | 'quantity' | 'rate' | 'amount';

// The values of a current line that can differ from the file.
export interface LineValues {
  lineType: InvoiceLineType;
  serviceDate: string | null;
  description: string | null;
  quantity: number | null;
  unitRate: number | null;
  amount: number | null;
}

const near = (a: number | null, b: number | null) => (a === null || a === 0 ? b === null || b === 0 : b !== null && Math.abs(a - b) < 0.005);

export function readLineType(read: FileLine): InvoiceLineType {
  return read.lineType === 'time' || read.lineType === 'mileage' || read.lineType === 'expense' ? read.lineType : 'other';
}

// Mirrors the server's lineChanged: a priced line's amount follows its
// quantity and rate, so only items with a typed amount compare amounts.
export function changedFields(read: FileLine, line: LineValues): ChangedField[] {
  const fields: ChangedField[] = [];
  if ((read.serviceDate ?? null) !== (line.serviceDate || null)) fields.push('date');
  if ((read.description ?? '').trim() !== (line.description ?? '').trim()) fields.push('description');
  if (!near(read.quantity, line.quantity)) fields.push('quantity');
  if (line.lineType === 'time' && !near(read.unitRate, line.unitRate)) fields.push('rate');
  if (line.lineType !== 'time' && line.lineType !== 'mileage' && !near(read.amount, line.amount)) fields.push('amount');
  return fields;
}

export type Row<L> =
  | { kind: 'line'; number: number; line: L; index: number; read: FileLine | undefined }
  | { kind: 'removed'; number: number; read: FileLine };

// File order, removed lines in their place; added lines follow, numbered on.
export function rowsInFileOrder<L>(fileLines: FileLine[], lines: L[], locationOf: (line: L) => string | null | undefined): Array<Row<L>> {
  const byLocation = new Map<string, number>();
  lines.forEach((line, index) => {
    const location = locationOf(line);
    if (location && !byLocation.has(location)) byLocation.set(location, index);
  });
  const rows: Array<Row<L>> = fileLines.map((read, position) => {
    const index = byLocation.get(read.location);
    return index === undefined
      ? { kind: 'removed', number: position + 1, read }
      : { kind: 'line', number: position + 1, line: lines[index]!, index, read };
  });
  const placed = new Set(rows.flatMap((row) => (row.kind === 'line' ? [row.index] : [])));
  lines.forEach((line, index) => {
    if (!placed.has(index)) {
      rows.push({ kind: 'line', number: rows.length + 1, line, index, read: undefined });
    }
  });
  return rows;
}

export const quantityUnit = (lineType: InvoiceLineType) => (lineType === 'time' ? 'h' : lineType === 'mileage' ? 'mi' : '');

export function formatQuantity(lineType: InvoiceLineType, quantity: number | null): string {
  if (quantity === null || quantity === 0) return '—';
  const unit = quantityUnit(lineType);
  return lineType === 'time' ? `${quantity.toFixed(2)} ${unit}` : unit ? `${quantity} ${unit}` : String(quantity);
}

// "You changed miles from 84 to 64." for the line's note.
export function changeSentence(read: FileLine, line: LineValues, fields: ChangedField[]): string {
  if (fields.length === 1 && fields[0] === 'quantity' && (line.lineType === 'time' || line.lineType === 'mileage')) {
    const noun = line.lineType === 'time' ? 'hours' : 'miles';
    return `You changed ${noun} from ${read.quantity ?? 0} to ${line.quantity ?? 0}.`;
  }
  const names: Record<ChangedField, string> = {
    date: 'the date',
    description: 'what was done',
    quantity: line.lineType === 'time' ? 'the hours' : line.lineType === 'mileage' ? 'the miles' : 'the quantity',
    rate: 'the rate',
    amount: 'the amount',
  };
  const list = fields.map((field) => names[field]);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `You changed ${joined}.`;
}

// Each line with the same date, words and amount as an earlier one, by row
// number, mapped to that earlier line's number.
export function duplicateOf<L>(rows: Array<Row<L>>, valuesOf: (line: L) => LineValues & { total: number | null }): Map<number, number> {
  const seen = new Map<string, number>();
  const duplicates = new Map<number, number>();
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    const values = valuesOf(row.line);
    if (!values.serviceDate || !values.description || values.total === null) continue;
    const key = `${values.serviceDate}|${values.description.trim().toLowerCase()}|${values.total.toFixed(2)}`;
    const earlier = seen.get(key);
    if (earlier === undefined) {
      seen.set(key, row.number);
    } else {
      duplicates.set(row.number, earlier);
    }
  }
  return duplicates;
}
