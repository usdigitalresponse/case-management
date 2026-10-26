// One row per submitted invoice for reporting outside the tool
// (model/rules.yaml report_billing_results): what reports need, keyed by
// case number. Line detail stays in the tool. Any route back to an
// external case system (a direct write, a nightly file or a shared
// spreadsheet) reads these rows; for now they download as CSV or a
// spreadsheet.
import { desc, inArray } from 'drizzle-orm';
import writeXlsxFile, { type Row } from 'write-excel-file/node';
import type { Database } from '../db/client';
import { invoiceEvent } from '../db/schema';
import { loadInvoiceDetail } from './invoiceDetail';
import { listReviewQueue } from './reviewQueue';
import { APPROVED_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

export const BILLING_RECORD_COLUMNS = [
  'Case number',
  'Court numbers',
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

export type BillingRecordRow = Record<(typeof BILLING_RECORD_COLUMNS)[number], string | number | null>;

const day = (value: Date | string | null | undefined) =>
  value ? (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)) : null;

export async function loadBillingRecord(db: Database): Promise<BillingRecordRow[]> {
  const { invoices } = await listReviewQueue(db, 'all');
  if (invoices.length === 0) {
    return [];
  }
  const events = await db
    .select({ invoiceId: invoiceEvent.invoiceId, occurredAt: invoiceEvent.occurredAt })
    .from(invoiceEvent)
    .where(inArray(invoiceEvent.invoiceId, invoices.map((row) => row.invoiceId)))
    .orderBy(desc(invoiceEvent.occurredAt));
  const rows: BillingRecordRow[] = [];
  for (const queued of invoices) {
    // eslint-disable-next-line no-await-in-loop
    const detail = await loadInvoiceDetail(db, queued.invoiceId, 'staff');
    if (!detail) continue;
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
      'Case number': queued.caseId === null ? 'Not linked to a case' : (queued.caseNumber ?? queued.caseExternalReference),
      'Court numbers': queued.otherCaseNumbers.join(', ') || null,
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
      'Status changed': day(events.find((event) => event.invoiceId === queued.invoiceId)?.occurredAt),
      Reviewer: queued.reviewer?.displayName ?? null,
      'Signed off by': signOff?.displayName ?? null,
      'Signed off on': day(signOff?.decidedAt),
    });
  }
  return rows;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function billingRecordCsv(rows: BillingRecordRow[]): string {
  return [BILLING_RECORD_COLUMNS.join(','), ...rows.map((row) => BILLING_RECORD_COLUMNS.map((column) => csvCell(row[column])).join(','))].join('\n');
}

export function billingRecordXlsx(rows: BillingRecordRow[]): Promise<Buffer> {
  const sheet: Row[] = [
    BILLING_RECORD_COLUMNS.map((column) => ({ value: column, fontWeight: 'bold' as const })),
    ...rows.map((row): Row =>
      BILLING_RECORD_COLUMNS.map((column) => {
        const value = row[column];
        return typeof value === 'number' ? { value, type: Number, format: '#,##0.00' } : { value: value ?? undefined };
      }),
    ),
  ];
  return writeXlsxFile(sheet, { sheet: 'Billing record', columns: BILLING_RECORD_COLUMNS.map(() => ({ width: 18 })) }).toBuffer();
}
