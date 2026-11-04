// For each date this invoice claims travel, the same professional's other
// invoices on another case that claim travel that day, so a reviewer can
// check them together (model/rules.yaml apply_time_category_rates).
import { and, eq, inArray, isNotNull, ne, notInArray, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { invoice, invoiceLine, invoiceStatuses } from '../db/schema';
import { DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

export interface SameDayTravel {
  date: string;
  otherInvoiceCount: number;
}

// The case an invoice is for: its case, else the number as corrected or typed.
const caseKey = sql<string>`coalesce(${invoice.caseId}::text, ${invoice.caseNumberCorrected}, ${invoice.caseNumberAsTyped}, '')`;

export async function sameDayTravel(
  db: DatabaseOrTransaction,
  header: { invoiceId: string; professionalId: string | null; caseId: string | null; caseNumberCorrected: string | null; caseNumberAsTyped: string | null },
  lines: Array<{ tripId: string | null; serviceDate: string | null }>,
): Promise<SameDayTravel[]> {
  const dates = [...new Set(lines.flatMap((line) => (line.tripId && line.serviceDate ? [line.serviceDate] : [])))];
  if (!header.professionalId || dates.length === 0) {
    return [];
  }
  const ownCase = header.caseId ?? header.caseNumberCorrected ?? header.caseNumberAsTyped ?? '';
  const rows = await db
    .selectDistinct({ date: invoiceLine.serviceDate, invoiceId: invoice.invoiceId })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(
      and(
        eq(invoice.professionalId, header.professionalId),
        ne(invoice.invoiceId, header.invoiceId),
        notInArray(invoiceStatuses.code, [DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE]),
        isNotNull(invoiceLine.tripId),
        inArray(invoiceLine.serviceDate, dates),
        ne(caseKey, ownCase),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.date as string, (counts.get(row.date as string) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([date, otherInvoiceCount]) => ({ date, otherInvoiceCount }));
}
