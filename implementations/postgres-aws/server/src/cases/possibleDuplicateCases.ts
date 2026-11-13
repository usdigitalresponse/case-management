// Open cases that may be one recorded twice (model/rules.yaml flag_possible_duplicate_case): numbers matching
// but for punctuation and leading zeros, or flagged by staff. Never across counties (a missing one doesn't rule a
// pair out), and never truly merged, since cases belong to the external system.
import { membersOf } from '../duplicateMembers';
import { z } from 'zod';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { caseDuplicateReview, caseIdentifier, caseTable, county, invoice, person, userAccount } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { closeKey } from '../billing/caseNumbers';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { groupPairs, pairKey, pairsByKey } from '../duplicatePairs';
import { groupBy } from '../groupBy';

export type DuplicateCaseReason = 'same_number' | 'same_county' | 'flagged';

export interface DuplicateCaseSummary {
  caseId: string;
  caseNumber: string | null;
  otherNumbers: string[];
  clientDisplayName: string | null;
  countyDisplayName: string | null;
  openedOn: string | null;
  invoiceCount: number;
}

export interface DuplicateCasePair {
  caseIds: [string, string];
  reasons: DuplicateCaseReason[];
  flagged: { note: string | null; byDisplayName: string; at: Date } | null;
}

export interface PossibleDuplicateCase {
  cases: DuplicateCaseSummary[];
  pairs: DuplicateCasePair[];
}

// Shorter numbers match too often to mean anything.
const MIN_KEY_LENGTH = 4;

async function latestReviews(db: DatabaseOrTransaction) {
  const rows = await db
    .selectDistinctOn([caseDuplicateReview.caseId, caseDuplicateReview.otherCaseId], {
      caseId: caseDuplicateReview.caseId,
      otherCaseId: caseDuplicateReview.otherCaseId,
      outcome: caseDuplicateReview.outcome,
      note: caseDuplicateReview.note,
      at: caseDuplicateReview.recordedAt,
      byDisplayName: userAccount.displayName,
    })
    .from(caseDuplicateReview)
    .innerJoin(userAccount, eq(caseDuplicateReview.recordedByUserAccountId, userAccount.userAccountId))
    .orderBy(caseDuplicateReview.caseId, caseDuplicateReview.otherCaseId, desc(caseDuplicateReview.recordedAt));
  return new Map(rows.map((row) => [pairKey(row.caseId, row.otherCaseId), row]));
}

// Open cases only: closing the extra one here takes the pair off the list.
export async function listPossibleDuplicateCases(db: DatabaseOrTransaction): Promise<PossibleDuplicateCase[]> {
  const cases = await db
    .select({ caseId: caseTable.caseId, externalReference: caseTable.externalReference, countyId: caseTable.countyId })
    .from(caseTable)
    .where(isNull(caseTable.closedOn));
  const countyOf = new Map(cases.map((row) => [row.caseId, row.countyId]));
  const ids = cases.map((row) => row.caseId);
  const identifiers = ids.length ? await db.select({ caseId: caseIdentifier.caseId, value: caseIdentifier.value }).from(caseIdentifier).where(inArray(caseIdentifier.caseId, ids)) : [];
  const identifiersOf = groupBy(identifiers, (row) => row.caseId);
  const numbersOf = (caseId: string, externalReference: string | null) =>
    [externalReference, ...(identifiersOf.get(caseId) ?? []).map((row) => row.value)]
      .filter((value): value is string => Boolean(value))
      .map(closeKey)
      .filter((key) => key.length >= MIN_KEY_LENGTH);

  const reasons = new Map<string, Set<string>>();
  pairsByKey(cases, (row) => row.caseId, (row) => numbersOf(row.caseId, row.externalReference), 'same_number', reasons);
  const reviews = await latestReviews(db);
  const open = new Set(ids);
  for (const [key, review] of reviews) {
    if (review.outcome === 'possible_duplicate' && open.has(review.caseId) && open.has(review.otherCaseId)) {
      reasons.set(key, (reasons.get(key) ?? new Set()).add('flagged'));
    }
  }
  // Cases in different counties are different cases, even if flagged before a county changed.
  for (const [key, found] of reasons) {
    const [a, b] = key.split('|').map((caseId) => countyOf.get(caseId));
    if (a && b && a !== b) reasons.delete(key);
    else if (a && a === b && found.has('same_number')) found.add('same_county');
  }
  const pairs: DuplicateCasePair[] = [...reasons]
    .filter(([key]) => reviews.get(key)?.outcome !== 'not_duplicate')
    .map(([key, found]) => {
      const review = reviews.get(key);
      return {
        caseIds: key.split('|') as [string, string],
        reasons: [...found] as DuplicateCaseReason[],
        flagged: review?.outcome === 'possible_duplicate' ? { note: review.note, byDisplayName: review.byDisplayName, at: review.at } : null,
      };
    });
  const summaries = await summarizeCases(db, [...new Set(pairs.flatMap((pair) => pair.caseIds))]);
  return groupPairs(pairs, (pair) => pair.caseIds).map((group) => ({
    cases: [...new Set(group.flatMap((pair) => pair.caseIds))].map((id) => summaries.get(id)!),
    pairs: group,
  }));
}

async function summarizeCases(db: DatabaseOrTransaction, caseIds: string[]): Promise<Map<string, DuplicateCaseSummary>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select({ caseId: caseTable.caseId, clientDisplayName: person.displayName, countyDisplayName: county.displayName, openedOn: caseTable.openedOn })
    .from(caseTable)
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(county, eq(caseTable.countyId, county.countyId))
    .where(inArray(caseTable.caseId, caseIds));
  const invoices = await db.select({ caseId: invoice.caseId, count: count() }).from(invoice).where(inArray(invoice.caseId, caseIds)).groupBy(invoice.caseId);
  const numbers = await loadCaseNumbers(db, caseIds);
  return new Map(
    rows.map((row) => [
      row.caseId,
      {
        ...row,
        caseNumber: numbers.get(row.caseId)?.caseNumber ?? null,
        otherNumbers: numbers.get(row.caseId)?.otherNumbers ?? [],
        invoiceCount: invoices.find((found) => found.caseId === row.caseId)?.count ?? 0,
      },
    ]),
  );
}

const reviewSchema = z.object({
  caseIds: z.tuple([z.uuid(), z.uuid()]).refine(([a, b]) => a !== b, 'Choose two different cases.'),
  outcome: z.enum(['possible_duplicate', 'not_duplicate']),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || null),
});

// Any staff member: flag two open cases, or record that they are different.
export async function recordCaseDuplicateReview(db: Database, actorUserAccountId: string, rawInput: unknown) {
  const parsed = reviewSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ caseIds: parsed.error.issues[0]?.message ?? 'Choose two different cases.' });
  }
  const [first, second] = [...parsed.data.caseIds].sort() as [string, string];
  const found = await db
    .select({ caseId: caseTable.caseId, countyId: caseTable.countyId })
    .from(caseTable)
    .where(and(inArray(caseTable.caseId, [first, second]), isNull(caseTable.closedOn)));
  if (found.length !== 2) {
    throw new NotFoundError('One of these cases is closed or no longer listed.');
  }
  const [a, b] = found.map((row) => row.countyId);
  if (parsed.data.outcome === 'possible_duplicate' && a && b && a !== b) {
    throw new ValidationError({ caseIds: 'These cases are in different counties, so they are different cases.' });
  }
  await db.insert(caseDuplicateReview).values({
    caseId: first,
    otherCaseId: second,
    outcome: parsed.data.outcome,
    note: parsed.data.note,
    recordedByUserAccountId: actorUserAccountId,
    recordedAt: new Date(),
  });
}

// Who each case may be a duplicate of, for its page.
export function caseDuplicateMembers(groups: PossibleDuplicateCase[]) {
  const numbers = new Map(groups.flatMap((group) => group.cases.map((record) => [record.caseId, record.caseNumber ?? 'a case with no number'] as const)));
  return membersOf(groups.flatMap((group) => group.pairs.map((pair) => pair.caseIds)), (caseId) => numbers.get(caseId) ?? 'another case');
}
