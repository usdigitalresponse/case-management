// What every parser produces: supplier-stated values and where each came
// from, before matching to this system's records.
import { ValidationError } from '../errors';
import type { LineType } from '../billing/invoiceLifecycle';

// invoice_import_formats codes; 'document' is a PDF.
export type ImportFormat = 'ledes_1998b' | 'spreadsheet' | 'document';

export interface ParsedLine {
  // e.g. "line 3", "row 4", "page 1, row 2".
  location: string;
  lineType: LineType;
  serviceDate?: string;
  description?: string;
  timekeeperLabel?: string;
  quantity?: number;
  unitRate?: number;
  amount: number;
  taskCode?: string;
  activityCode?: string;
  expenseCode?: string;
}

export interface ParsedInvoice {
  invoiceNumber?: string;
  periodStart?: string;
  periodEnd?: string;
  statedTotal?: number;
  lines: ParsedLine[];
}

// Larger files are almost certainly bulk exports of many invoices.
const MAX_IMPORTED_LINES = 1000;

// Its message is shown to the submitter.
export class UnreadableInvoiceFileError extends ValidationError {
  constructor(message: string) {
    super({ file: message });
  }
}

export function parseAmount(raw: string | number | null | undefined, location: string, field: string): number | undefined {
  if (raw === null || raw === undefined || raw === '') {
    return undefined;
  }
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(value)) {
    throw new UnreadableInvoiceFileError(`${location}: ${field} "${raw}" is not a number.`);
  }
  return value;
}

export function checkLineCount(lines: unknown[]): void {
  if (lines.length === 0) {
    throw new UnreadableInvoiceFileError('The file has no invoice items.');
  }
  if (lines.length > MAX_IMPORTED_LINES) {
    throw new UnreadableInvoiceFileError(`The file has more than ${MAX_IMPORTED_LINES} items; upload one invoice at a time.`);
  }
}

export function optionalText(value: unknown): string | undefined {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text === '' ? undefined : text;
}

// Shown on import review; never blocks it.
export interface ImportWarning {
  code: string;
  message: string;
  location?: string;
}

const cents = (value: number) => Math.round(value * 100);

export function reconciliationWarnings(parsed: ParsedInvoice): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const lineTotal = parsed.lines.reduce((sum, line) => sum + cents(line.amount), 0);
  if (parsed.statedTotal !== undefined && cents(parsed.statedTotal) !== lineTotal) {
    warnings.push({
      code: 'stated_total_mismatch',
      message: `The file states a total of ${parsed.statedTotal.toFixed(2)}, but its items add up to ${(lineTotal / 100).toFixed(2)}. The invoice total is calculated from the items.`,
    });
  }
  for (const line of parsed.lines) {
    if (line.quantity !== undefined && line.unitRate !== undefined && cents(line.quantity * line.unitRate) !== cents(line.amount)) {
      warnings.push({
        code: 'rate_mismatch',
        location: line.location,
        message: `${line.quantity} × ${line.unitRate.toFixed(2)} is ${(line.quantity * line.unitRate).toFixed(2)}, not the stated ${line.amount.toFixed(2)}.`,
      });
    }
    if (
      line.serviceDate &&
      parsed.periodStart &&
      parsed.periodEnd &&
      (line.serviceDate < parsed.periodStart || line.serviceDate > parsed.periodEnd)
    ) {
      warnings.push({
        code: 'date_outside_period',
        location: line.location,
        message: `${line.serviceDate} is outside the billing period ${parsed.periodStart} to ${parsed.periodEnd}.`,
      });
    }
  }
  return warnings;
}
