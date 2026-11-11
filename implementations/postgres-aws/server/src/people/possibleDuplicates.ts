// People who may be one person recorded twice (model/rules.yaml
// flag_possible_duplicate_client): found by matching details, or flagged by
// staff. Staff may record that a pair are different people; only an
// administrator merges them (./personMerges.ts). Nothing is merged here.
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
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

export interface PossibleDuplicate {
  people: [DuplicatePersonSummary, DuplicatePersonSummary];
  reasons: DuplicateReason[];
  flagged: { note: string | null; byDisplayName: string; at: Date } | null;
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

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

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

  const reasons = new Map<string, Set<DuplicateReason>>();
  function group(reason: DuplicateReason, keyOf: (row: (typeof rows)[number]) => (string | null)[]) {
    const byKey = new Map<string, Set<string>>();
    for (const row of rows) {
      for (const key of keyOf(row)) {
        if (key) byKey.set(key, (byKey.get(key) ?? new Set()).add(row.personId));
      }
    }
    for (const ids of byKey.values()) {
      const list = [...ids];
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const key = pairKey(list[i]!, list[j]!);
          reasons.set(key, (reasons.get(key) ?? new Set()).add(reason));
        }
      }
    }
  }
  group('same_email', (row) => [row.email?.trim().toLowerCase() ?? null, row.signInEmail?.trim().toLowerCase() ?? null]);
  group('same_name', (row) => [nameKey(row.displayName) || null]);
  group('same_birth_date_and_family_name', (row) => [row.dateOfBirth && familyKey(row) ? `${row.dateOfBirth}|${familyKey(row)}` : null]);

  const reviews = await latestReviews(db);
  const active = new Set(rows.map((row) => row.personId));
  for (const [key, review] of reviews) {
    if (review.outcome === 'possible_duplicate' && active.has(review.personId) && active.has(review.otherPersonId)) {
      reasons.set(key, (reasons.get(key) ?? new Set()).add('flagged'));
    }
  }
  const pairs = [...reasons].filter(([key]) => reviews.get(key)?.outcome !== 'not_duplicate');
  const summaries = await summarize(db, [...new Set(pairs.flatMap(([key]) => key.split('|')))]);
  return pairs.map(([key, found]) => {
    const [a, b] = key.split('|') as [string, string];
    const review = reviews.get(key);
    return {
      people: [summaries.get(a)!, summaries.get(b)!],
      reasons: [...found],
      flagged: review?.outcome === 'possible_duplicate' ? { note: review.note, byDisplayName: review.byDisplayName, at: review.at } : null,
    };
  });
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
    .where(inArray(person.personId, personIds));
  const cases = await db.execute<{ person_id: string; count: number }>(sql`
    select person_id, count(distinct case_id)::int as count from (
      select ${caseParticipant.personId} as person_id, ${caseParticipant.caseId} as case_id from ${caseParticipant}
        where ${inArray(caseParticipant.personId, personIds)}
      union
      select ${caseTable.clientId}, ${caseTable.caseId} from ${caseTable} where ${inArray(caseTable.clientId, personIds)}
    ) named group by person_id`);
  const invoices = await db
    .select({ personId: professional.personId, count: sql<number>`count(*)::int` })
    .from(invoice)
    .innerJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .where(inArray(professional.personId, personIds))
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
