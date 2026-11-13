// People who may be one person recorded twice (model/rules.yaml
// flag_possible_duplicate_client): found by matching details, or flagged by
// staff. Staff may record that a pair are different people; only an
// administrator merges them (./personMerges.ts). Nothing is merged here.
import { membersOf } from '../duplicateMembers';
import { z } from 'zod';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { inIds } from '../db/inIds';
import {
  caseParticipant,
  caseTable,
  invoice,
  person,
  personDuplicateReview,
  professional,
  professionalKinds,
  userAccount,
} from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { groupPairs, pairKey, pairsByKey } from '../duplicatePairs';

export type DuplicateReason = 'same_email' | 'same_name' | 'same_birth_date_and_family_name' | 'flagged';

export interface DuplicatePersonSummary {
  personId: string;
  displayName: string;
  email: string | null;
  dateOfBirth: string | null;
  provider: { professionalId: string; kind: string | null; signInEmail: string | null } | null;
  caseCount: number;
  invoiceCount: number;
}

export interface DuplicatePair {
  personIds: [string, string];
  reasons: DuplicateReason[];
  flagged: { note: string | null; byDisplayName: string; at: Date } | null;
}

// Everyone linked by any pair: likely one person recorded several times.
export interface PossibleDuplicate {
  people: DuplicatePersonSummary[];
  pairs: DuplicatePair[];
}

// Word order, punctuation, case and initials don't tell people apart.
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .sort()
    .join(' ');
}

// "Doe, Jane" names the family first.
export function familyKey(row: { displayName: string; familyName: string | null }): string {
  const family = row.familyName ?? (row.displayName.includes(',') ? row.displayName.split(',')[0]! : row.displayName.trim().split(/\s+/).at(-1)!);
  return nameKey(family);
}


// Latest staff finding per pair.
async function latestReviews(db: DatabaseOrTransaction) {
  const rows = await db
    .selectDistinctOn([personDuplicateReview.personId, personDuplicateReview.otherPersonId], {
      personId: personDuplicateReview.personId,
      otherPersonId: personDuplicateReview.otherPersonId,
      outcome: personDuplicateReview.outcome,
      note: personDuplicateReview.note,
      at: personDuplicateReview.recordedAt,
      byDisplayName: userAccount.displayName,
    })
    .from(personDuplicateReview)
    .innerJoin(userAccount, eq(personDuplicateReview.recordedByUserAccountId, userAccount.userAccountId))
    .orderBy(personDuplicateReview.personId, personDuplicateReview.otherPersonId, desc(personDuplicateReview.recordedAt));
  return new Map(rows.map((row) => [pairKey(row.personId, row.otherPersonId), row]));
}

// Read in full and compared here: fine at this prototype's scale (see ../../MAPPING.md).
export async function listPossibleDuplicates(db: DatabaseOrTransaction): Promise<PossibleDuplicate[]> {
  const rows = await db
    .select({
      personId: person.personId,
      displayName: person.displayName,
      familyName: person.familyName,
      email: person.email,
      dateOfBirth: person.dateOfBirth,
      signInEmail: userAccount.email,
    })
    .from(person)
    .leftJoin(professional, eq(professional.personId, person.personId))
    .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
    .where(isNull(person.mergedIntoPersonId));

  const reasons = new Map<string, Set<string>>();
  const idOf = (row: (typeof rows)[number]) => row.personId;
  pairsByKey(rows, idOf, (row) => [row.email?.trim().toLowerCase() ?? null, row.signInEmail?.trim().toLowerCase() ?? null], 'same_email', reasons);
  pairsByKey(rows, idOf, (row) => [nameKey(row.displayName) || null], 'same_name', reasons);
  pairsByKey(rows, idOf, (row) => [row.dateOfBirth && familyKey(row) ? `${row.dateOfBirth}|${familyKey(row)}` : null], 'same_birth_date_and_family_name', reasons);

  const reviews = await latestReviews(db);
  const active = new Set(rows.map((row) => row.personId));
  for (const [key, review] of reviews) {
    if (review.outcome === 'possible_duplicate' && active.has(review.personId) && active.has(review.otherPersonId)) {
      reasons.set(key, (reasons.get(key) ?? new Set()).add('flagged'));
    }
  }
  const pairs: DuplicatePair[] = [...reasons]
    .filter(([key]) => reviews.get(key)?.outcome !== 'not_duplicate')
    .map(([key, found]) => {
      const review = reviews.get(key);
      return {
        personIds: key.split('|') as [string, string],
        reasons: [...found] as DuplicateReason[],
        flagged: review?.outcome === 'possible_duplicate' ? { note: review.note, byDisplayName: review.byDisplayName, at: review.at } : null,
      };
    });
  const summaries = await summarize(db, [...new Set(pairs.flatMap((pair) => pair.personIds))]);
  return groupPairs(pairs, (pair) => pair.personIds).map((group) => ({
    people: [...new Set(group.flatMap((pair) => pair.personIds))].map((id) => summaries.get(id)!),
    pairs: group,
  }));
}

export async function summarize(db: DatabaseOrTransaction, personIds: string[]): Promise<Map<string, DuplicatePersonSummary>> {
  if (personIds.length === 0) return new Map();
  // One after another: a transaction runs one query at a time.
  const rows = await db
    .select({
      personId: person.personId,
      displayName: person.displayName,
      email: person.email,
      dateOfBirth: person.dateOfBirth,
      professionalId: professional.professionalId,
      kind: professionalKinds.displayName,
      signInEmail: userAccount.email,
    })
    .from(person)
    .leftJoin(professional, eq(professional.personId, person.personId))
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
    .where(inIds(person.personId, personIds));
  const cases = await db.execute<{ person_id: string; count: number }>(sql`
    select person_id, count(distinct case_id)::int as count from (
      select ${caseParticipant.personId} as person_id, ${caseParticipant.caseId} as case_id from ${caseParticipant}
        where ${inIds(caseParticipant.personId, personIds)}
      union
      select ${caseTable.clientId}, ${caseTable.caseId} from ${caseTable} where ${inIds(caseTable.clientId, personIds)}
    ) named group by person_id`);
  const invoices = await db
    .select({ personId: professional.personId, count: sql<number>`count(*)::int` })
    .from(invoice)
    .innerJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .where(inIds(professional.personId, personIds))
    .groupBy(professional.personId);
  const caseCounts = new Map(cases.rows.map((row) => [row.person_id, row.count]));
  const invoiceCounts = new Map(invoices.map((row) => [row.personId, row.count]));
  return new Map(
    rows.map((row) => [
      row.personId,
      {
        personId: row.personId,
        displayName: row.displayName,
        email: row.email,
        dateOfBirth: row.dateOfBirth,
        provider: row.professionalId ? { professionalId: row.professionalId, kind: row.kind, signInEmail: row.signInEmail } : null,
        caseCount: caseCounts.get(row.personId) ?? 0,
        invoiceCount: invoiceCounts.get(row.personId) ?? 0,
      },
    ]),
  );
}

const reviewSchema = z.object({
  personIds: z.tuple([z.uuid(), z.uuid()]).refine(([a, b]) => a !== b, 'Choose two different people.'),
  outcome: z.enum(['possible_duplicate', 'not_duplicate']),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || null),
});

// Any staff member: flag a pair, or record that they are different people.
export async function recordDuplicateReview(db: Database, actorUserAccountId: string, rawInput: unknown) {
  const parsed = reviewSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ personIds: parsed.error.issues[0]?.message ?? 'Choose two different people.' });
  }
  const [first, second] = [...parsed.data.personIds].sort() as [string, string];
  const found = await db
    .select({ personId: person.personId })
    .from(person)
    .where(and(or(eq(person.personId, first), eq(person.personId, second)), isNull(person.mergedIntoPersonId)));
  if (found.length !== 2) {
    throw new NotFoundError('One of these people is no longer listed.');
  }
  await db.insert(personDuplicateReview).values({
    personId: first,
    otherPersonId: second,
    outcome: parsed.data.outcome,
    note: parsed.data.note,
    recordedByUserAccountId: actorUserAccountId,
    recordedAt: new Date(),
  });
}

// Who each person may be a duplicate of, for a provider's page.
export function personDuplicateMembers(groups: PossibleDuplicate[]) {
  const names = new Map(groups.flatMap((group) => group.people.map((one) => [one.personId, one.displayName] as const)));
  return membersOf(groups.flatMap((group) => group.pairs.map((pair) => pair.personIds)), (personId) => names.get(personId) ?? 'someone else');
}
