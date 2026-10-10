// What import would read from invoice files, as text, JSON or CSV
// (scripts/extract-invoice.ts). Kept free of database dependencies so it can
// become a standalone tool.
import { AppError } from '../errors';
import { detectInvoiceFile } from './detectFormat';
import { reconciliationWarnings, type ImportWarning, type ParsedLine } from './parsedInvoice';
import { csvCell } from './template';

export type ReportFormat = 'text' | 'json' | 'csv';

export interface ExtractionReport {
  file: string;
  format?: string;
  extractionMethod?: string;
  invoice?: { invoiceNumber?: string; periodStart?: string; periodEnd?: string; statedTotal?: number };
  lines?: ParsedLine[];
  warnings?: ImportWarning[];
  // Set instead of the other fields when the file couldn't be read.
  error?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof AppError) {
    const body = error.toResponseBody() as { message?: string; fieldErrors?: Record<string, string> };
    return Object.values(body.fieldErrors ?? {})[0] ?? body.message ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function extractReport(file: string, bytes: Buffer): Promise<ExtractionReport> {
  try {
    const detected = detectInvoiceFile(bytes);
    const { lines, ...invoice } = await detected.parse();
    return {
      file,
      format: detected.format,
      extractionMethod: detected.extractionMethod,
      invoice,
      lines,
      warnings: reconciliationWarnings({ ...invoice, lines }),
    };
  } catch (error) {
    return { file, error: errorMessage(error) };
  }
}

export function formatText(reports: ExtractionReport[]): string {
  const out: string[] = [];
  for (const report of reports) {
    out.push(`== ${report.file}`);
    if (report.error) {
      out.push(`  not read: ${report.error}`, '');
      continue;
    }
    const invoice = report.invoice ?? {};
    out.push(
      `read as ${report.format} by ${report.extractionMethod}`,
      `invoice ${invoice.invoiceNumber ?? '?'}, period ${invoice.periodStart ?? '?'} – ${invoice.periodEnd ?? '?'}, stated total ${invoice.statedTotal ?? '?'}`,
    );
    for (const line of report.lines ?? []) {
      out.push(
        `  ${line.location.padEnd(16)} ${line.lineType.padEnd(7)} ${(line.serviceDate ?? '').padEnd(10)} ` +
          `${(line.timekeeperLabel ?? '').slice(0, 18).padEnd(18)} ${String(line.quantity ?? '').padStart(5)} ` +
          `${String(line.unitRate ?? '').padStart(7)} ${line.amount.toFixed(2).padStart(9)}  ${line.description ?? ''}`,
      );
    }
    for (const warning of report.warnings ?? []) {
      out.push(`  warning: ${warning.location ? `${warning.location}: ` : ''}${warning.message}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function formatJson(reports: ExtractionReport[]): string {
  return `${JSON.stringify(reports, null, 2)}\n`;
}

const CSV_COLUMNS = [
  'file', 'format', 'extraction_method', 'invoice_number', 'period_start', 'period_end', 'stated_total',
  'location', 'type', 'date', 'timekeeper', 'description', 'hours', 'rate', 'amount',
  'task_code', 'activity_code', 'expense_code', 'warnings', 'error',
] as const;

// One row per item; invoice-level warnings repeat on every row of the file.
export function formatCsv(reports: ExtractionReport[]): string {
  const rows: Array<Partial<Record<(typeof CSV_COLUMNS)[number], string | number>>> = [];
  for (const report of reports) {
    if (report.error) {
      rows.push({ file: report.file, error: report.error });
      continue;
    }
    const invoiceWarnings = (report.warnings ?? []).filter((warning) => !warning.location).map((warning) => warning.message);
    for (const line of report.lines ?? []) {
      const lineWarnings = (report.warnings ?? []).filter((warning) => warning.location === line.location).map((warning) => warning.message);
      rows.push({
        file: report.file,
        format: report.format,
        extraction_method: report.extractionMethod,
        invoice_number: report.invoice?.invoiceNumber,
        period_start: report.invoice?.periodStart,
        period_end: report.invoice?.periodEnd,
        stated_total: report.invoice?.statedTotal,
        location: line.location,
        type: line.lineType,
        date: line.serviceDate,
        timekeeper: line.timekeeperLabel,
        description: line.description,
        hours: line.quantity,
        rate: line.unitRate,
        amount: line.amount,
        task_code: line.taskCode,
        activity_code: line.activityCode,
        expense_code: line.expenseCode,
        warnings: [...invoiceWarnings, ...lineWarnings].join('; ') || undefined,
      });
    }
  }
  return `${[CSV_COLUMNS.join(','), ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column] ?? '')).join(','))].join('\r\n')}\r\n`;
}

export function formatReports(reports: ExtractionReport[], format: ReportFormat): string {
  return format === 'json' ? formatJson(reports) : format === 'csv' ? formatCsv(reports) : formatText(reports);
}
