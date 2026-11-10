// PDF and spreadsheet exports of one submitted invoice, both rendered from
// invoiceExportContent. A submitted invoice can't be edited, so its current
// values are its snapshot's; earlier attempts aren't exportable yet.
import PDFDocument from 'pdfkit';
import writeXlsxFile, { type Row } from 'write-excel-file/node';
import type { InvoiceDetail, InvoiceDetailLine } from './invoiceDetail';
import { currentCaseNumber } from './caseNumbers';

export type InvoiceExportFormat = 'pdf' | 'xlsx';

export const NO_CASE_WARNING =
  'Not linked to a case. This system did not check the case, the provider’s assignment or any pre-authorization.';

export const INVOICE_EXPORT_MEDIA_TYPES: Record<InvoiceExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const LINE_COLUMNS = ['Date', 'Type', 'Description', 'Timekeeper', 'Codes', 'Hours / qty', 'Rate', 'Requested', 'Decision', 'Approved', 'Reason', 'Reviewed by'];
const TRAVEL_COLUMNS = ['Date', 'From', 'To', 'Round trip', 'Travel hours', 'Miles claimed', 'Driving route (mi)', 'Travel expenses', 'Requested'];

// What the person exporting may leave out, before sending the file on, by
// the name it's shown under; the totals and invoice ID always stay. Keys
// are `group:name` (exportFieldKey), as the client's export dialog sends.
export const OMITTABLE_EXPORT_FIELDS = {
  summary: ['Case number', 'Court numbers', 'County', 'Client', 'Professional', 'Submitted by', 'Signed off', 'Decision comment'],
  lines: LINE_COLUMNS,
  travel: TRAVEL_COLUMNS,
} as const;

export type ExportFieldGroup = keyof typeof OMITTABLE_EXPORT_FIELDS;

export function exportFieldKey(group: ExportFieldGroup, name: string): string {
  return `${group}:${name}`;
}

export interface InvoiceExportOptions {
  // Reviewer names are shown to staff only.
  includeReviewer: boolean;
  exportedAt: Date;
  // exportFieldKey values to leave out.
  omit?: ReadonlySet<string>;
}

type Cell = string | number | null;

export interface InvoiceExportContent {
  summary: Array<[string, string]>;
  columns: string[];
  rows: Cell[][];
  amountColumns: Set<number>;
  // Mileage items' trips, in place of a printed map; empty without mileage.
  travelLog: { columns: string[]; rows: Cell[][]; amountColumns: Set<number> };
  // Says what was left out, so no one takes the file for the full record.
  redactionNote: string | null;
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function formatInstant(value: Date | null): string {
  return value ? value.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '';
}

function lineCodes(line: InvoiceDetailLine): string {
  return [line.taskCode, line.activityCode, line.expenseCode].filter(Boolean).join(' / ');
}

// invoice_line_types codes as shown to people; 'service' is "Other".
const LINE_TYPE_LABELS: Record<string, string> = { time: 'Time', expense: 'Expense' };

function keepColumns(group: ExportFieldGroup, columns: string[], rows: Cell[][], omit: ReadonlySet<string>, omitted: string[]) {
  const kept = columns.flatMap((name, index) => (omit.has(exportFieldKey(group, name)) ? [] : [index]));
  omitted.push(...columns.filter((name) => omit.has(exportFieldKey(group, name))).map((name) => (group === 'travel' ? `${name} (travel log)` : name)));
  return { columns: kept.map((index) => columns[index]!), rows: rows.map((row) => kept.map((index) => row[index]!)) };
}

function columnSet(columns: string[], names: string[]): Set<number> {
  return new Set(names.map((name) => columns.indexOf(name)).filter((index) => index >= 0));
}

export function invoiceExportContent(detail: InvoiceDetail, options: InvoiceExportOptions): InvoiceExportContent {
  const { invoice, lines } = detail;
  const period =
    invoice.periodStart || invoice.periodEnd ? `${invoice.periodStart ?? ''} to ${invoice.periodEnd ?? ''}` : '';
  const summary: Array<[string, string]> = [
    ['Invoice', invoice.invoiceId],
    // Reviewed without a case: say so, as the warning on screen does.
    ['Case number', currentCaseNumber(invoice) ?? detail.caseNumber ?? invoice.caseExternalReference ?? invoice.caseId ?? NO_CASE_WARNING],
    ['Court numbers', detail.otherCaseNumbers.join(', ')],
    ['County', invoice.countyDisplayName ?? ''],
    ['Client', invoice.caseClientDisplayName ?? ''],
    ['Professional', invoice.professionalDisplayName ?? ''],
    ['Submitted by', invoice.submittedByDisplayName ?? ''],
    ['Status', invoice.statusDisplayName ?? ''],
    ['Submitted', formatInstant(invoice.submittedAt)],
    ['Submission attempt', detail.submissionAttempt?.invoiceApprovalChainId ?? ''],
    ['Billing period', period],
    ['Currency', invoice.currencyCode],
    ['Requested total', invoice.submittedTotal],
    ['Approved total', detail.approvedTotal ?? '0.00'],
    ...detail.signOffs
      .filter((signOff) => signOff.outcomeCode === 'approved')
      .map((signOff): [string, string] => ['Signed off', `${signOff.displayName ?? ''} ${formatInstant(signOff.decidedAt)}`.trim()]),
    // Shared like line notes; a send-back comment is internal and never exported.
    ...detail.signOffs
      .filter((signOff) => signOff.outcomeCode !== 'changes_requested' && signOff.comment && !signOff.internalOnly)
      .map((signOff): [string, string] => ['Decision comment', signOff.comment!]),
    ['Exported', formatInstant(options.exportedAt)],
  ];

  // Each line's latest decision only; earlier rounds stay in the tool
  // (model/rules.yaml authorize_payment_request_export).
  const allColumns = options.includeReviewer ? LINE_COLUMNS : LINE_COLUMNS.filter((name) => name !== 'Reviewed by');

  const allRows = lines.map((line) => {
    const row: Cell[] = [
      line.serviceDate ?? line.sourceActivityOn ?? '',
      line.expenseTypeCode === 'mileage'
        ? 'Mileage'
        : line.tripId && line.lineTypeCode === 'time'
          ? 'Travel time'
          : line.timeCategory === 'waiting'
            ? 'Waiting time'
            : (LINE_TYPE_LABELS[line.lineTypeCode ?? ''] ?? 'Other'),
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
    if (options.includeReviewer) {
      row.push(line.decidedByDisplayName ?? '');
    }
    return row;
  });

  // One row per trip: its travel time, miles and other costs together.
  const trips = new Map<string, typeof lines>();
  for (const line of lines) {
    if (line.tripId) trips.set(line.tripId, [...(trips.get(line.tripId) ?? []), line]);
  }
  const travelRows = [...trips.values()].map((tripLines) => {
    const [first] = tripLines;
    const travel = tripLines.find((line) => line.lineTypeCode === 'time');
    const mileage = tripLines.find((line) => line.expenseTypeCode === 'mileage');
    const costs = tripLines.filter((line) => line !== travel && line !== mileage);
    const sum = (some: typeof lines) => some.reduce((cents, line) => cents + Math.round(Number(line.amount) * 100), 0) / 100;
    return [
      first!.serviceDate ?? '',
      first!.tripOrigin ?? '',
      first!.tripDestination ?? '',
      first!.roundTrip ? 'Yes' : 'No',
      travel ? toNumber(travel.quantity ?? travel.sourceDurationHours) : null,
      mileage ? toNumber(mileage.quantity) : null,
      // Both ways for a round trip, as claimed.
      !mileage ? null : first!.routeDistance === null ? 'Not checked' : Number(first!.routeDistance) * (first!.roundTrip ? 2 : 1),
      costs.length > 0 ? sum(costs) : null,
      sum(tripLines),
    ];
  });

  const omit = options.omit ?? new Set<string>();
  const omitted = [...new Set(summary.map(([label]) => label).filter((label) => omit.has(exportFieldKey('summary', label))))];
  const table = keepColumns('lines', allColumns, allRows, omit, omitted);
  const travel = keepColumns('travel', TRAVEL_COLUMNS, travelRows, omit, travelRows.length > 0 ? omitted : []);
  return {
    summary: summary.filter(([label]) => !omit.has(exportFieldKey('summary', label))),
    ...table,
    amountColumns: columnSet(table.columns, ['Rate', 'Requested', 'Approved']),
    travelLog: { ...travel, amountColumns: columnSet(travel.columns, ['Travel expenses', 'Requested']) },
    redactionNote: omitted.length > 0 ? `Redacted copy. Left out: ${omitted.join(', ')}.` : null,
  };
}

// Money to the cent, except a rate per mile, which may have a third place.
function formatAmount(value: number): string {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6 ? value.toFixed(2) : value.toFixed(3);
}

export function invoiceExportFileName(detail: InvoiceDetail, format: InvoiceExportFormat, redacted = false): string {
  return `invoice-${detail.invoice.invoiceId.slice(0, 8)}${redacted ? '-redacted' : ''}.${format}`;
}

// Leaving out every column of a table leaves out the table.
function hasTable(table: { columns: string[]; rows: Cell[][] }): boolean {
  return table.columns.length > 0 && table.rows.length > 0;
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
    ...(content.redactionNote ? [[{ value: content.redactionNote, fontWeight: 'bold' as const }], []] : []),
    ...content.summary.map(([label, value]): Row => [{ value: label, fontWeight: 'bold' }, { value }]),
    [],
    ...(hasTable(content) ? table(content.columns, content.rows, content.amountColumns) : []),
    ...(hasTable(travelLog)
      ? [[], [{ value: 'Travel log', fontWeight: 'bold' as const }], ...table(travelLog.columns, travelLog.rows, travelLog.amountColumns)]
      : []),
  ];
  return writeXlsxFile(sheet, { sheet: 'Invoice', columns: (content.columns.length > 0 ? content.columns : ['']).map(() => ({ width: 18 })) }).toBuffer();
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
  if (content.redactionNote) {
    doc.moveDown(0.3).fontSize(10).text(content.redactionNote);
  }
  doc.moveDown(0.5).fontSize(10);
  for (const [label, value] of content.summary) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value || '—');
  }
  doc.moveDown();

  const formatCell = (cell: string | number | null, index: number, amountColumns = content.amountColumns): string =>
    cell === null ? '' : typeof cell === 'number' ? (amountColumns.has(index) ? formatAmount(cell) : String(cell)) : cell;
  // Widths in points across the landscape page; unlisted columns share the rest.
  const widths: Record<string, number> = {
    Date: 56, Type: 42, Timekeeper: 78, Codes: 72, 'Hours / qty': 42, Rate: 48, Requested: 52,
    Decision: 52, Approved: 52, Reason: 84, 'Reviewed by': 70,
  };
  const hoursColumn = content.columns.indexOf('Hours / qty');
  if (hasTable(content)) {
    doc.fontSize(8).table({
      columnStyles: (column) => ({
        width: widths[content.columns[column]!] ?? '*',
        align: content.amountColumns.has(column) || column === hoursColumn ? { x: 'right' } : { x: 'left' },
      }),
      data: [
        content.columns.map((header) => ({ text: header, font: { src: 'Helvetica-Bold' } })),
        ...content.rows.map((row) => row.map((cell, index) => formatCell(cell, index))),
      ],
    });
  }

  const { travelLog } = content;
  if (hasTable(travelLog)) {
    const travelWidths: Record<string, number> = {
      Date: 56, 'Round trip': 48, 'Travel hours': 60, 'Miles claimed': 72, 'Driving route (mi)': 48, 'Travel expenses': 56,
    };
    const leftAligned = new Set(['Date', 'From', 'To', 'Round trip']);
    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Travel log', doc.page.margins.left);
    doc.moveDown(0.3).fontSize(8).table({
      columnStyles: (column) => ({
        width: travelWidths[travelLog.columns[column]!] ?? '*',
        align: leftAligned.has(travelLog.columns[column]!) ? { x: 'left' } : { x: 'right' },
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
