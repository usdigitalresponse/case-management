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
  // Mileage items' trips, in place of a printed map; empty without mileage.
  travelLog: { columns: string[]; rows: Array<Array<string | number | null>>; amountColumns: Set<number> };
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
    // Sign-off comments are internal and never exported.
    ...detail.signOffs
      .filter((signOff) => signOff.outcomeCode === 'approved')
      .map((signOff): [string, string] => ['Signed off', `${signOff.displayName ?? ''} ${formatInstant(signOff.decidedAt)}`.trim()]),
    ['Exported', formatInstant(options.exportedAt)],
  ];

  const hasHistory = lines.some((line) => line.history.length > 0);
  const columns = ['Date', 'Type', 'Description', 'Timekeeper', 'Codes', 'Hours / qty', 'Rate', 'Requested', 'Decision', 'Approved', 'Reason'];
  if (hasHistory) {
    columns.push('Earlier decisions');
  }
  if (options.includeReviewer) {
    columns.push('Reviewed by');
  }

  const rows = lines.map((line) => {
    const row: Array<string | number | null> = [
      line.serviceDate ?? line.sourceActivityOn ?? '',
      line.expenseTypeCode === 'mileage' ? 'Mileage' : (LINE_TYPE_LABELS[line.lineTypeCode ?? ''] ?? 'Other'),
      line.description ?? line.sourceDescription ?? '',
      line.timekeeperDisplayName ?? line.timekeeperLabel ?? '',
      lineCodes(line),
      toNumber(line.quantity ?? line.sourceDurationHours),
      // The rate billed; a non-time line's stated rate otherwise.
      toNumber(line.billedRate ?? line.unitRate),
      toNumber(line.amount),
      line.decisionOutcomeDisplayName ?? 'Not reviewed',
      toNumber(line.decisionApprovedAmount),
      line.decisionReason ?? '',
    ];
    if (hasHistory) {
      row.push(
        line.history
          .map((past) =>
            [
              `Round ${past.round}: ${past.outcomeDisplayName}`,
              past.approvedAmount && past.outcomeCode !== 'approved' ? past.approvedAmount : null,
              past.reasonDisplayName,
              past.note,
            ]
              .filter(Boolean)
              .join(', '),
          )
          .join('; '),
      );
    }
    if (options.includeReviewer) {
      row.push(line.decidedByDisplayName ?? '');
    }
    return row;
  });

  const amountColumns = new Set(['Rate', 'Requested', 'Approved'].map((name) => columns.indexOf(name)));

  const travelColumns = ['Date', 'From', 'To', 'Round trip', 'Miles claimed', 'Driving route (mi)', 'Rate', 'Requested'];
  const travelRows = lines
    .filter((line) => line.expenseTypeCode === 'mileage')
    .map((line) => [
      line.serviceDate ?? '',
      line.tripOrigin ?? '',
      line.tripDestination ?? '',
      line.roundTrip ? 'Yes' : 'No',
      toNumber(line.quantity),
      // Both ways for a round trip, as claimed.
      line.routeDistance === null ? 'Not checked' : Number(line.routeDistance) * (line.roundTrip ? 2 : 1),
      toNumber(line.billedRate),
      toNumber(line.amount),
    ]);
  const travelLog = { columns: travelColumns, rows: travelRows, amountColumns: new Set([6, 7]) };
  return { summary, columns, rows, amountColumns, travelLog };
}

// Money to the cent, except a rate per mile, which may have a third place.
function formatAmount(value: number): string {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6 ? value.toFixed(2) : value.toFixed(3);
}

export function invoiceExportFileName(detail: InvoiceDetail, format: InvoiceExportFormat): string {
  return `invoice-${detail.invoice.invoiceId.slice(0, 8)}.${format}`;
}

export async function renderInvoiceXlsx(detail: InvoiceDetail, options: InvoiceExportOptions): Promise<Buffer> {
  const content = invoiceExportContent(detail, options);
  const table = (columns: string[], rows: InvoiceExportContent['rows'], amountColumns: Set<number>): Row[] => [
    columns.map((header) => ({ value: header, fontWeight: 'bold' as const })),
    ...rows.map((row): Row =>
      row.map((cell, index) =>
        typeof cell === 'number'
          ? { value: cell, type: Number, format: amountColumns.has(index) ? '#,##0.00#' : undefined }
          : { value: cell ?? undefined },
      ),
    ),
  ];
  const { travelLog } = content;
  const sheet: Row[] = [
    ...content.summary.map(([label, value]): Row => [{ value: label, fontWeight: 'bold' }, { value }]),
    [],
    ...table(content.columns, content.rows, content.amountColumns),
    ...(travelLog.rows.length > 0
      ? [[], [{ value: 'Travel log', fontWeight: 'bold' as const }], ...table(travelLog.columns, travelLog.rows, travelLog.amountColumns)]
      : []),
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

  const formatCell = (cell: string | number | null, index: number, amountColumns = content.amountColumns): string =>
    cell === null ? '' : typeof cell === 'number' ? (amountColumns.has(index) ? formatAmount(cell) : String(cell)) : cell;
  // Widths in points across the landscape page; description takes the rest.
  const widths = [56, 42, '*', 78, 72, 42, 48, 52, 52, 52, 84, ...(content.columns.includes('Earlier decisions') ? [90] : []), 70];
  const hoursColumn = content.columns.indexOf('Hours / qty');
  doc.fontSize(8).table({
    columnStyles: (column) => ({
      width: widths[column] ?? '*',
      align: content.amountColumns.has(column) || column === hoursColumn ? { x: 'right' } : { x: 'left' },
    }),
    data: [
      content.columns.map((header) => ({ text: header, font: { src: 'Helvetica-Bold' } })),
      ...content.rows.map((row) => row.map((cell, index) => formatCell(cell, index))),
    ],
  });

  const { travelLog } = content;
  if (travelLog.rows.length > 0) {
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Travel log', doc.page.margins.left);
    doc.moveDown(0.3).fontSize(8).table({
      columnStyles: (column) => ({
        width: [56, '*', '*', 48, 60, 72, 48, 56][column] ?? '*',
        align: column >= 4 ? { x: 'right' } : { x: 'left' },
      }),
      data: [
        travelLog.columns.map((header) => ({ text: header, font: { src: 'Helvetica-Bold' } })),
        ...travelLog.rows.map((row) => row.map((cell, index) => formatCell(cell, index, travelLog.amountColumns))),
      ],
    });
  }

  doc.end();
  return done;
}
