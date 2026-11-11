// Cases whose number, or any of their other numbers, is the one an invoice
// gives: exactly, else closely (../billing/caseNumbers.ts closeKey). For
// matching an invoice filed by person to its case.
import { eq, inArray, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { DatabaseOrTransaction } from '../db/client';
import { caseIdentifier, caseTable, county, person } from '../db/schema';
import { closeKey } from '../billing/caseNumbers';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { byCase } from './byCase';

export interface CaseByNumber {
  caseId: string;
  caseNumber: string | null;
  otherNumbers: string[];
  clientDisplayName: string | null;
  countyDisplayName: string | null;
  closed: boolean;
  match: 'exact' | 'close';
}

export async function findCasesByNumber(db: DatabaseOrTransaction, caseNumber: string | null): Promise<CaseByNumber[]> {
  if (!caseNumber) return [];
  const wantedClose = closeKey(caseNumber);
  // An exact match has the same key too; without one, every case is read.
  const keyed = wantedClose
    ? unionAll(
        db.select({ caseId: caseTable.caseId }).from(caseTable).where(eq(sql`case_number_close_key(${caseTable.externalReference})`, wantedClose)),
        db.select({ caseId: caseIdentifier.caseId }).from(caseIdentifier).where(eq(sql`case_number_close_key(${caseIdentifier.value})`, wantedClose)),
      )
    : undefined;
  const [cases, identifiers] = await Promise.all([
    db
      .select({
        caseId: caseTable.caseId,
        externalReference: caseTable.externalReference,
        clientDisplayName: person.displayName,
        countyDisplayName: county.displayName,
        closedOn: caseTable.closedOn,
      })
      .from(caseTable)
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .leftJoin(county, eq(caseTable.countyId, county.countyId))
      .where(keyed ? inArray(caseTable.caseId, keyed) : undefined),
    db
      .select({ caseId: caseIdentifier.caseId, value: caseIdentifier.value })
      .from(caseIdentifier)
      .where(keyed ? inArray(caseIdentifier.caseId, keyed) : undefined),
  ]);
  const identifiersOf = byCase(identifiers);
  const wanted = caseNumber.toUpperCase();
  const found = cases.flatMap((row) => {
    const numbers = [row.externalReference, ...(identifiersOf.get(row.caseId) ?? []).map((id) => id.value)].filter(
      (value): value is string => Boolean(value),
    );
    const match = numbers.some((value) => value.toUpperCase() === wanted)
      ? ('exact' as const)
      : wantedClose && numbers.some((value) => closeKey(value) === wantedClose)
        ? ('close' as const)
        : null;
    return match ? [{ row, match }] : [];
  });
  const numbers = await loadCaseNumbers(db, found.map(({ row }) => row.caseId));
  return found
    .map(({ row, match }) => ({
      caseId: row.caseId,
      caseNumber: numbers.get(row.caseId)?.caseNumber ?? null,
      otherNumbers: numbers.get(row.caseId)?.otherNumbers ?? [],
      clientDisplayName: row.clientDisplayName,
      countyDisplayName: row.countyDisplayName,
      closed: row.closedOn !== null,
      match,
    }))
    .sort((a, b) => (a.match === b.match ? 0 : a.match === 'exact' ? -1 : 1));
}
