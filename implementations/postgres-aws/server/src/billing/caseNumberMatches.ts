// Other sent invoices with the same or a close case number (./caseNumbers.ts): its current one, else its case's.
import { aliasedTable, and, count, eq, inArray, isNull, notInArray, sql, type SQLWrapper } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { DatabaseOrTransaction } from '../db/client';
import { caseIdentifier, caseTable, invoice, invoiceStatuses } from '../db/schema';
import { closeKey, exactKey, type CaseNumberMatches } from './caseNumbers';
import { DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

const primaryIdentifier = aliasedTable(caseIdentifier, 'primary_identifier');
const typedNumber = sql<string | null>`coalesce(${invoice.caseNumberCorrected}, ${invoice.caseNumberAsTyped})`;
const effectiveNumber = sql<string | null>`coalesce(${typedNumber}, ${primaryIdentifier.value}, ${caseTable.externalReference})`;
// Matches the expression indexes in ../db/schema.ts.
const keyOf = (value: SQLWrapper) => sql`case_number_close_key(${value})`;

function sentInvoiceNumbers(db: DatabaseOrTransaction) {
  return db
    .select({ number: effectiveNumber, invoices: count() })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(primaryIdentifier, and(eq(primaryIdentifier.caseId, invoice.caseId), eq(primaryIdentifier.isPrimary, true)))
    .$dynamic();
}

const sent = notInArray(invoiceStatuses.code, [DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE]);

// Counts every sent invoice's number once, grouped, for a list of many.
export async function sentCaseNumberCounts(db: DatabaseOrTransaction): Promise<(caseNumber: string | null) => CaseNumberMatches> {
  return countsFrom(await sentInvoiceNumbers(db).where(sent).groupBy(effectiveNumber));
}

function countsFrom(rows: Array<{ number: string | null; invoices: number }>): (caseNumber: string | null) => CaseNumberMatches {
  const exact = new Map<string, number>();
  const close = new Map<string, number>();
  for (const { number, invoices } of rows) {
    if (!number) continue;
    exact.set(exactKey(number), (exact.get(exactKey(number)) ?? 0) + invoices);
    close.set(closeKey(number), (close.get(closeKey(number)) ?? 0) + invoices);
  }
  // The invoice asked about is one of the sent ones it counts.
  return (caseNumber) => {
    if (!caseNumber) return { same: 0, close: 0 };
    const same = exact.get(exactKey(caseNumber)) ?? 0;
    return { same: Math.max(0, same - 1), close: Math.max(0, (close.get(closeKey(caseNumber)) ?? 0) - same) };
  };
}

// Sent invoices whose number has one of these keys: their typed one, else their case's.
function sentWithKeys(db: DatabaseOrTransaction, keys: string[]) {
  const casesWithKey = unionAll(
    db
      .select({ caseId: caseIdentifier.caseId })
      .from(caseIdentifier)
      .where(and(eq(caseIdentifier.isPrimary, true), sql`${keyOf(caseIdentifier.value)} = any(${sql.param(keys)}::text[])`)),
    db
      .select({ caseId: caseTable.caseId })
      .from(caseTable)
      .where(
        and(
          sql`${keyOf(caseTable.externalReference)} = any(${sql.param(keys)}::text[])`,
          sql`not exists (select 1 from ${caseIdentifier} where ${caseIdentifier.caseId} = ${caseTable.caseId} and ${caseIdentifier.isPrimary})`,
        ),
      ),
  );
  // Two indexed lookups; an OR of them scans every invoice.
  return inArray(
    invoice.invoiceId,
    unionAll(
      db.select({ invoiceId: invoice.invoiceId }).from(invoice).where(sql`${keyOf(typedNumber)} = any(${sql.param(keys)}::text[])`),
      db.select({ invoiceId: invoice.invoiceId }).from(invoice).where(and(isNull(typedNumber), inArray(invoice.caseId, casesWithKey))),
    ),
  );
}

// sentCaseNumberCounts for only these numbers, reading only invoices and cases with their keys.
export async function sentCaseNumberCountsFor(
  db: DatabaseOrTransaction,
  numbers: Array<string | null>,
): Promise<(caseNumber: string | null) => CaseNumberMatches> {
  const keys = [...new Set(numbers.flatMap((number) => (number ? [closeKey(number)] : [])))];
  const rows = keys.length === 0 ? [] : await sentInvoiceNumbers(db).where(and(sent, sentWithKeys(db, keys))).groupBy(effectiveNumber);
  return countsFrom(rows);
}

// The same for one invoice.
export async function caseNumberMatchesFor(db: DatabaseOrTransaction, invoiceId: string): Promise<CaseNumberMatches> {
  const [own] = await sentInvoiceNumbers(db)
    .where(and(eq(invoice.invoiceId, invoiceId), sent))
    .groupBy(effectiveNumber);
  const number = own?.number;
  if (!number) return { same: 0, close: 0 };
  return (await sentCaseNumberCountsFor(db, [number]))(number);
}
