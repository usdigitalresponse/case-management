// One row per submitted invoice, keyed by case number, for reports outside the tool (model/rules.yaml
// report_billing_results); downloaded as CSV or a spreadsheet. Line detail stays in the tool.
import { and, eq, inArray, max, ne } from 'drizzle-orm';
import writeXlsxFile, { type Row } from 'write-excel-file/node';
import type { Database } from '../db/client';
import { invoiceEvent, invoiceEventTypes } from '../db/schema';
import { COMMUNICATION_COMPLETED_EVENT_CODE } from './invoiceEvents';
import { loadInvoiceDetail } from './invoiceDetail';
import { listReviewQueue } from './reviewQueue';
import { currentCaseNumber } from './caseNumbers';
import { APPROVED_INVOICE_STATUS_CODE } from './invoiceStatusCodes';
import { csvCell } from '../imports/template';

export const BILLING_RECORD_COLUMNS = [
  'Case number',
  'Court numbers',
  'County',
  'Client',
  'Invoice number',
  'Provider',
  'Provider role',
  'Submitted by',
  'Received by',
  'Received on',
  'Billing period start',
  'Billing period end',
  'Date submitted',
  'Amount requested',
  'Amount approved',
  'Amount cut',
  'Reasons used',
  'Status',
  'Status changed',
  'Reviewer',
  'Signed off by',
  'Signed off on',
] as const;

export type BillingRecordColumn = (typeof BILLING_RECORD_COLUMNS)[number];
export type BillingRecordRow = Record<BillingRecordColumn, string | number | null>;

// As with one invoice's export, the reference and amounts are always kept.
const ALWAYS_KEPT = new Set<BillingRecordColumn>(['Invoice number', 'Amount requested', 'Amount approved', 'Amount cut']);
export const OMITTABLE_BILLING_RECORD_COLUMNS = BILLING_RECORD_COLUMNS.filter((column) => !ALWAYS_KEPT.has(column));

function keptColumns(omit: ReadonlySet<string>): BillingRecordColumn[] {
  return BILLING_RECORD_COLUMNS.filter((column) => !omit.has(column));
}

export function billingRecordRedactionNote(omit: ReadonlySet<string>): string | null {
  const leftOut = BILLING_RECORD_COLUMNS.filter((column) => omit.has(column));
  return leftOut.length === 0 ? null : `Redacted copy. Left out: ${leftOut.join(', ')}.`;
}

const day = (value: Date | string | null | undefined) =>
  value ? (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)) : null;

// YYYY-MM-DD; a period keeps overlapping billing periods, never invoices without one.
export interface BillingRecordFilter {
  countyId?: string;
  periodFrom?: string;
  periodTo?: string;
  signedOffOnly?: boolean;
}

function overlapsPeriod(start: string | null, end: string | null, { periodFrom, periodTo }: BillingRecordFilter): boolean {
  if (!periodFrom && !periodTo) return true;
  const first = start ?? end;
  const last = end ?? start;
  if (!first || !last) return false;
  return (!periodTo || first <= periodTo) && (!periodFrom || last >= periodFrom);
}

export async function loadBillingRecord(db: Database, filter: BillingRecordFilter = {}): Promise<BillingRecordRow[]> {
  const invoices = (await listReviewQueue(db, 'all')).invoices.filter(
    (row) =>
      (!filter.signedOffOnly || row.statusCode === APPROVED_INVOICE_STATUS_CODE) &&
      overlapsPeriod(row.periodStart, row.periodEnd, filter),
  );
  if (invoices.length === 0) {
    return [];
  }
  const invoiceIds = invoices.map((row) => row.invoiceId);
  const [lastEvents, details] = await Promise.all([
    db
      .select({ invoiceId: invoiceEvent.invoiceId, occurredAt: max(invoiceEvent.occurredAt) })
      .from(invoiceEvent)
      .innerJoin(invoiceEventTypes, eq(invoiceEventTypes.id, invoiceEvent.eventTypeId))
      // Marking communication completed doesn't change the status.
      .where(and(inArray(invoiceEvent.invoiceId, invoiceIds), ne(invoiceEventTypes.code, COMMUNICATION_COMPLETED_EVENT_CODE)))
      .groupBy(invoiceEvent.invoiceId),
    Promise.all(invoiceIds.map((invoiceId) => loadInvoiceDetail(db, invoiceId, 'staff'))),
  ]);
  const statusChanged = new Map(lastEvents.map((event) => [event.invoiceId, event.occurredAt]));
  const rows: BillingRecordRow[] = [];
  for (const [index, queued] of invoices.entries()) {
    const detail = details[index];
    if (!detail || (filter.countyId && detail.invoice.countyId !== filter.countyId)) continue;
    const signedOff = queued.statusCode === APPROVED_INVOICE_STATUS_CODE;
    const signOff = detail.signOffs.filter((entry) => entry.outcomeCode === 'approved').at(-1);
    const approved = signedOff ? Number(queued.approvedTotal ?? 0) : null;
    const reasons = [
      ...new Set(
        detail.lines
          .filter((line) => line.decision && line.decision.outcomeCode !== 'approved')
          .map((line) => line.decision?.reasonDisplayName)
          .filter((reason): reason is string => Boolean(reason)),
      ),
    ];
    rows.push({
      'Case number':
        currentCaseNumber(queued) ?? (queued.caseId === null ? 'Not linked to a case' : (queued.caseNumber ?? queued.caseExternalReference)),
      'Court numbers': queued.otherCaseNumbers.join(', ') || null,
      County: detail.invoice.countyDisplayName,
      Client: detail.invoice.caseClientDisplayName,
      'Invoice number': queued.invoiceId.slice(0, 8),
      Provider: queued.professionalDisplayName,
      'Provider role': queued.professionalKindDisplayName,
      'Submitted by': queued.submittedByDisplayName,
      'Received by': queued.receivedViaDisplayName,
      'Received on': queued.receivedOn,
      'Billing period start': queued.periodStart,
      'Billing period end': queued.periodEnd,
      'Date submitted': day(queued.submittedAt),
      'Amount requested': Number(queued.submittedTotal),
      'Amount approved': approved,
      'Amount cut': approved === null ? null : Math.round((Number(queued.submittedTotal) - approved) * 100) / 100,
      'Reasons used': signedOff ? reasons.join('; ') || null : null,
      Status: queued.statusDisplayName,
      'Status changed': day(statusChanged.get(queued.invoiceId)),
      Reviewer: queued.reviewer?.displayName ?? null,
      'Signed off by': signOff?.displayName ?? null,
      'Signed off on': day(signOff?.decidedAt),
    });
  }
  return rows;
}

// Amounts to cents; blank for none; text that a spreadsheet would run as a formula is quoted with '.
function cell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return csvCell(value.toFixed(2));
  return csvCell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

// A redacted CSV is labelled only by its file name, so it stays one header row and data.
export function billingRecordCsv(rows: BillingRecordRow[], omit: ReadonlySet<string> = new Set()): string {
  const columns = keptColumns(omit);
  const lines = [columns.join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

export function billingRecordXlsx(rows: BillingRecordRow[], omit: ReadonlySet<string> = new Set()): Promise<Buffer> {
  const columns = keptColumns(omit);
  const note = billingRecordRedactionNote(omit);
  const sheet: Row[] = [
    ...(note ? [[{ value: note, fontWeight: 'bold' as const }], []] : []),
    columns.map((column) => ({ value: column, fontWeight: 'bold' as const })),
    ...rows.map((row): Row =>
      columns.map((column) => {
        const value = row[column];
        return typeof value === 'number' ? { value, type: Number, format: '#,##0.00' } : { value: value ?? undefined };
      }),
    ),
  ];
  return writeXlsxFile(sheet, { sheet: 'Billing record', columns: columns.map(() => ({ width: 18 })) }).toBuffer();
}
