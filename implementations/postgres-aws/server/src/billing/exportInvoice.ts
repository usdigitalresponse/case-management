// PDF and spreadsheet exports of one submitted invoice, both rendered from
// invoiceExportContent. A submitted invoice can't be edited, so its current
// values are its snapshot's; earlier attempts aren't exportable yet.
import PDFDocument from 'pdfkit';
import writeXlsxFile, { type Row } from 'write-excel-file/node';
import type { InvoiceDetail, InvoiceDetailLine } from './invoiceDetail';

export type InvoiceExportFormat = 'pdf' | 'xlsx';

export const INVOICE_EXPORT_MEDIA_TYPES: Record<InvoiceExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface InvoiceExportOptions {
  // Reviewer names are shown to staff only.
  includeReviewer: boolean;
  exportedAt: Date;
}

export interface InvoiceExportContent {
  summary: Array<[string, string]>;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  amountColumns: Set<number>;
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toCents(value: string | null): number {
  return value === null ? 0 : Math.round(Number(value) * 100);
}

function formatInstant(value: Date | null): string {
  return value ? value.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '';
}

function lineCodes(line: InvoiceDetailLine): string {
  return [line.taskCode, line.activityCode, line.expenseCode].filter(Boolean).join(' / ');
}

// invoice_line_types codes as shown to people; 'service' is "Other".
const LINE_TYPE_LABELS: Record<string, string> = { time: 'Time', expense: 'Expense' };

export function invoiceExportContent(detail: InvoiceDetail, options: InvoiceExportOptions): InvoiceExportContent {
  const { invoice, lines } = detail;
  const approvedCents = lines.reduce((sum, line) => sum + toCents(line.decisionApprovedAmount), 0);
  const period =
    invoice.periodStart || invoice.periodEnd ? `${invoice.periodStart ?? ''} to ${invoice.periodEnd ?? ''}` : '';
  const caseLabel = [invoice.caseExternalReference, invoice.caseClientDisplayName].filter(Boolean).join(' / ');

  const summary: Array<[string, string]> = [
    ['Invoice', invoice.invoiceId],
    ['Case', caseLabel || invoice.caseId],
    ['Professional', invoice.professionalDisplayName ?? ''],
    ['Submitted by', invoice.submittedByDisplayName ?? ''],
    ['Status', invoice.statusDisplayName ?? ''],
    ['Submitted', formatInstant(invoice.submittedAt)],
    ['Submission attempt', detail.submissionAttempt?.invoiceApprovalChainId ?? ''],
    ['Billing period', period],
    ['Currency', invoice.currencyCode],
    ['Requested total', invoice.submittedTotal],
    ['Approved total', (approvedCents / 100).toFixed(2)],
    ['Exported', formatInstant(options.exportedAt)],
  ];

  const columns = ['Date', 'Type', 'Description', 'Timekeeper', 'Codes', 'Hours / qty', 'Rate', 'Requested', 'Decision', 'Approved', 'Reason'];
  if (options.includeReviewer) {
    columns.push('Reviewed by');
  }

  const rows = lines.map((line) => {
    const row: Array<string | number | null> = [
      line.serviceDate ?? line.sourceActivityOn ?? '',
      LINE_TYPE_LABELS[line.lineTypeCode ?? ''] ?? 'Other',
      line.description ?? line.sourceDescription ?? '',
      line.timekeeperDisplayName ?? line.timekeeperLabel ?? '',
      lineCodes(line),
      toNumber(line.quantity ?? line.sourceDurationHours),
      toNumber(line.unitRate),
      toNumber(line.amount),
      line.decisionOutcomeDisplayName ?? 'Not reviewed',
      toNumber(line.decisionApprovedAmount),
      line.decisionReason ?? '',
    ];
    if (options.includeReviewer) {
      row.push(line.decidedByDisplayName ?? '');
    }
    return row;
  });

  const amountColumns = new Set(['Rate', 'Requested', 'Approved'].map((name) => columns.indexOf(name)));
  return { summary, columns, rows, amountColumns };
}

export function invoiceExportFileName(detail: InvoiceDetail, format: InvoiceExportFormat): string {
  return `invoice-${detail.invoice.invoiceId.slice(0, 8)}.${format}`;
}

export async function renderInvoiceXlsx(detail: InvoiceDetail, options: InvoiceExportOptions): Promise<Buffer> {
  const content = invoiceExportContent(detail, options);
  const sheet: Row[] = [
    ...content.summary.map(([label, value]): Row => [{ value: label, fontWeight: 'bold' }, { value }]),
    [],
    content.columns.map((header) => ({ value: header, fontWeight: 'bold' as const })),
    ...content.rows.map((row): Row =>
      row.map((cell, index) =>
        typeof cell === 'number'
          ? { value: cell, type: Number, format: content.amountColumns.has(index) ? '#,##0.00' : undefined }
          : { value: cell ?? undefined },
      ),
    ),
  ];
  return writeXlsxFile(sheet, { sheet: 'Invoice', columns: content.columns.map(() => ({ width: 18 })) }).toBuffer();
}

export function renderInvoicePdf(detail: InvoiceDetail, options: InvoiceExportOptions): Promise<Buffer> {
  const content = invoiceExportContent(detail, options);
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36, info: { Title: 'Payment request' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.font('Helvetica-Bold').fontSize(16).text('Payment request');
  doc.moveDown(0.5).fontSize(10);
  for (const [label, value] of content.summary) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value || '—');
  }
  doc.moveDown();

  const formatCell = (cell: string | number | null, index: number): string =>
    cell === null ? '' : typeof cell === 'number' ? (content.amountColumns.has(index) ? cell.toFixed(2) : String(cell)) : cell;
  // Widths in points across the landscape page; description takes the rest.
  const widths = [56, 42, '*', 78, 72, 42, 48, 52, 52, 52, 84, 70];
  const hoursColumn = content.columns.indexOf('Hours / qty');
  doc.fontSize(8).table({
    columnStyles: (column) => ({
      width: widths[column] ?? '*',
      align: content.amountColumns.has(column) || column === hoursColumn ? { x: 'right' } : { x: 'left' },
    }),
    data: [
      content.columns.map((header) => ({ text: header, font: { src: 'Helvetica-Bold' } })),
      ...content.rows.map((row) => row.map(formatCell)),
    ],
  });

  doc.end();
  return done;
}
