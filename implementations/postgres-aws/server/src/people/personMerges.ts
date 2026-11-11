// An administrator merges a person recorded twice into the record they keep
// (model/rules.yaml merge_duplicate_people). The preview says exactly what
// moves; the merge records every value it changes, so it can be undone.
// The retired person stays, hidden, pointing at the kept one.
/* eslint-disable no-await-in-loop -- a transaction runs one query at a time, and the steps' order is undone in reverse */
import { z } from 'zod';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { office, person, personMerge, personMergeChange, professional, professionalKinds, userAccount } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { uniqueViolationConstraint } from '../db/rowHelpers';
import { summarize, type DuplicatePersonSummary } from './possibleDuplicates';

type PgType = 'uuid' | 'text' | 'date' | 'boolean';

interface Column {
  table: string;
  id: string;
  column: string;
  type: PgType;
}

// A null label moves without being listed.
const ref = (table: string, column: string, label: string | null) => ({ table, id: `${table}_id`, column, type: 'uuid' as const, label });

const PERSON_REFERENCES = [
  ref('case_participant', 'person_id', 'Roles on cases'),
  // Copies their client role on the case, listed above.
  ref('case', 'client_id', null),
  ref('person_affiliation', 'person_id', 'Organization memberships'),
  ref('invoice_attestation', 'attestor_person_id', 'Signed true-and-correct statements'),
  ref('preauthorization_request', 'requested_for_person_id', 'Pre-authorization requests made for them'),
  ref('user_account', 'person_id', 'Staff or sign-in accounts linked to them'),
];

const PROFESSIONAL_REFERENCES = [
  ref('invoice', 'professional_id', 'Invoices filed under them'),
  ref('invoice_line', 'timekeeper_professional_id', 'Invoice lines for their work'),
  ref('case_assignment', 'professional_id', 'Case assignments'),
  ref('time_entry', 'professional_id', 'Time entries'),
  ref('case_rate', 'professional_id', 'Case rates set on their invoices'),
  ref('preauthorization', 'professional_id', 'Pre-authorizations'),
  ref('preauthorization_request', 'professional_id', 'Pre-authorization requests'),
  ref('invoice_overrun_explanation', 'professional_id', 'Explanations for going over a pre-authorization'),
  ref('document_link', 'professional_id', 'Kept documents, such as CVs and fee schedules'),
  ref('invoice_import', 'suggested_professional_id', 'Uploads read as theirs'),
];

// Moved only when the kept person has none, so they never change the kept person's.
const PROFESSIONAL_OWN = [
  ref('professional_rate', 'professional_id', 'Their own rates'),
  ref('provider_service_rate', 'professional_id', 'Fee schedule'),
  ref('professional_invoice_reviewer', 'professional_id', 'Who reviews their invoices'),
];

// Filled in on the kept record only where it has nothing.
const PERSON_DETAILS: Array<{ column: string; key: 'givenName' | 'middleName' | 'familyName' | 'dateOfBirth' | 'email'; type: PgType; label: string }> = [
  { column: 'given_name', key: 'givenName', type: 'text', label: 'Given name' },
  { column: 'middle_name', key: 'middleName', type: 'text', label: 'Middle name' },
  { column: 'family_name', key: 'familyName', type: 'text', label: 'Family name' },
  { column: 'date_of_birth', key: 'dateOfBirth', type: 'date', label: 'Date of birth' },
  { column: 'email', key: 'email', type: 'text', label: 'Email' },
];
const PROFESSIONAL_DETAILS: Array<{ column: string; key: 'displayName' | 'phone' | 'paidThrough' | 'professionalKindId' | 'officeId'; type: PgType; label: string }> = [
  { column: 'display_name', key: 'displayName', type: 'text', label: 'Provider name' },
  { column: 'phone', key: 'phone', type: 'text', label: 'Phone' },
  { column: 'paid_through', key: 'paidThrough', type: 'text', label: 'Paid through' },
  { column: 'professional_kind_id', key: 'professionalKindId', type: 'uuid', label: 'Role' },
  { column: 'office_id', key: 'officeId', type: 'uuid', label: 'Office' },
];

// Every column a merge may change, by name, so an undo never writes elsewhere.
const CHANGEABLE = new Map<string, Column>(
  [
    ...PERSON_REFERENCES,
    ...PROFESSIONAL_REFERENCES,
    ...PROFESSIONAL_OWN,
    ...PERSON_DETAILS.map((detail) => ({ table: 'person', id: 'person_id', column: detail.column, type: detail.type })),
    ...PROFESSIONAL_DETAILS.map((detail) => ({ table: 'professional', id: 'professional_id', column: detail.column, type: detail.type })),
    { table: 'person', id: 'person_id', column: 'merged_into_person_id', type: 'uuid' as const },
    { table: 'professional', id: 'professional_id', column: 'person_id', type: 'uuid' as const },
    { table: 'professional', id: 'professional_id', column: 'user_account_id', type: 'uuid' as const },
    { table: 'professional', id: 'professional_id', column: 'active', type: 'boolean' as const },
  ].map((column) => [`${column.table}.${column.column}`, { table: column.table, id: column.id, column: column.column, type: column.type }]),
);

type Step =
  | { kind: 'move'; target: Column; from: string; to: string }
  | { kind: 'set'; target: Column; rowId: string; from: string | null; to: string | null };

const cast = (value: string | null, type: PgType) => (type === 'text' ? sql`${value}` : sql`cast(${value} as ${sql.raw(type)})`);

// What merging one retired person into the kept one does.
export interface RetiredPlan {
  person: DuplicatePersonSummary;
  moves: Array<{ label: string; count: number }>;
  filledIn: Array<{ label: string; value: string }>;
  notMoved: string[];
  blockers: string[];
}

export interface MergePreview {
  kept: DuplicatePersonSummary;
  retired: RetiredPlan[];
}

async function lookups(db: DatabaseOrTransaction, personIds: string[]) {
  const people = await db.select().from(person).where(inArray(person.personId, personIds));
  const professionals = await db
    .select({ row: professional, signInEmail: userAccount.email })
    .from(professional)
    .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
    .where(inArray(professional.personId, personIds));
  return {
    person: (id: string) => people.find((row) => row.personId === id),
    professional: (id: string) => professionals.find((found) => found.row.personId === id),
  };
}

async function count(db: DatabaseOrTransaction, target: Column, value: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(target.table)} where ${sql.identifier(target.column)} = ${cast(value, target.type)}`,
  );
  return result.rows[0]?.count ?? 0;
}

async function exists(db: DatabaseOrTransaction, query: ReturnType<typeof sql>): Promise<boolean> {
  return (await db.execute(query)).rows.length > 0;
}

async function plan(db: DatabaseOrTransaction, keptId: string, retiredId: string) {
  if (keptId === retiredId) {
    throw new ValidationError({ personIds: 'Choose two different people.' });
  }
  const found = await lookups(db, [keptId, retiredId]);
  const kept = found.person(keptId);
  const retired = found.person(retiredId);
  if (!kept || !retired) {
    throw new NotFoundError('One of these people is not in the system.');
  }
  const blockers: string[] = [];
  for (const one of [kept, retired]) {
    if (one.mergedIntoPersonId) blockers.push(`${one.displayName} has already been merged into someone else.`);
  }
  const keptProvider = found.professional(keptId);
  const retiredProvider = found.professional(retiredId);
  const steps: Step[] = [];
  const moves: RetiredPlan['moves'] = [];
  const filledIn: RetiredPlan['filledIn'] = [];
  const notMoved: string[] = [];

  async function move(target: Column & { label: string | null }, from: string, to: string) {
    const n = await count(db, target, from);
    if (n > 0) {
      if (target.label) moves.push({ label: target.label, count: n });
      steps.push({ kind: 'move', target, from, to });
    }
  }
  const set = (table: 'person' | 'professional', column: string, rowId: string, from: string | null, to: string | null) =>
    steps.push({ kind: 'set', target: CHANGEABLE.get(`${table}.${column}`)!, rowId, from, to });

  for (const target of PERSON_REFERENCES) await move(target, retiredId, keptId);
  for (const detail of PERSON_DETAILS) {
    const value = retired[detail.key];
    if (!kept[detail.key] && value) {
      filledIn.push({ label: detail.label, value });
      set('person', detail.column, keptId, null, value);
    }
  }

  if (await exists(db, sql`select 1 from case_participant a join case_participant b on a.case_id = b.case_id
      and a.participant_role_id = b.participant_role_id and a.affiliation_id is not distinct from b.affiliation_id
      where a.person_id = ${retiredId} and b.person_id = ${keptId} and a.ended_at is null and b.ended_at is null limit 1`)) {
    blockers.push('Both have the same open role on a case. End one of them on the case first.');
  }

  if (retiredProvider && !keptProvider) {
    moves.push({ label: 'Provider profile, with its invoices, rates and cases', count: 1 });
    set('professional', 'person_id', retiredProvider.row.professionalId, retiredId, keptId);
  } else if (retiredProvider && keptProvider) {
    const from = retiredProvider.row.professionalId;
    const to = keptProvider.row.professionalId;
    for (const target of PROFESSIONAL_REFERENCES) await move(target, from, to);
    for (const target of PROFESSIONAL_OWN) {
      const theirs = await count(db, target, from);
      if (theirs === 0) continue;
      if ((await count(db, target, to)) === 0) {
        await move(target, from, to);
      } else {
        notMoved.push(`${target.label}: ${kept.displayName}'s stay in use; ${retired.displayName}'s stay with the retired record.`);
      }
    }
    for (const detail of PROFESSIONAL_DETAILS) {
      const value = retiredProvider.row[detail.key];
      if (!keptProvider.row[detail.key] && value) {
        filledIn.push({ label: detail.label, value: await detailText(db, detail.key, value) });
        set('professional', detail.column, to, null, value);
      }
    }
    if (retiredProvider.row.userAccountId && keptProvider.row.userAccountId) {
      blockers.push(
        `Both sign in, with different accounts (${retiredProvider.signInEmail} and ${keptProvider.signInEmail}). Merging would leave one unable to reach their invoices.`,
      );
    } else if (retiredProvider.row.userAccountId) {
      moves.push({ label: `Sign-in: ${retiredProvider.signInEmail} will open ${kept.displayName}'s invoices`, count: 1 });
      set('professional', 'user_account_id', from, retiredProvider.row.userAccountId, null);
      set('professional', 'user_account_id', to, null, retiredProvider.row.userAccountId);
    }
    set('professional', 'active', from, 'true', 'false');
    if (await exists(db, sql`select 1 from case_assignment a join case_assignment b on a.case_id = b.case_id
        where a.professional_id = ${from} and b.professional_id = ${to} and a.ended_at is null and b.ended_at is null limit 1`)) {
      blockers.push('Both are assigned to the same case. End one of the assignments first.');
    }
    if (await exists(db, sql`select 1 from preauthorization a join preauthorization b on a.case_id = b.case_id
        where a.professional_id = ${from} and b.professional_id = ${to} limit 1`)) {
      blockers.push('Both have a pre-authorization on the same case, and a provider has one per case.');
    }
  }
  set('person', 'merged_into_person_id', retiredId, null, keptId);

  const summaries = await summarize(db, [retiredId]);
  const preview: RetiredPlan = { person: summaries.get(retiredId)!, moves, filledIn, notMoved, blockers };
  return { preview, steps };
}

async function detailText(db: DatabaseOrTransaction, key: string, value: string): Promise<string> {
  if (key === 'professionalKindId') {
    const [kind] = await db.select({ name: professionalKinds.displayName }).from(professionalKinds).where(eq(professionalKinds.id, value));
    return kind?.name ?? value;
  }
  if (key === 'officeId') {
    const [row] = await db.select({ name: office.displayName }).from(office).where(eq(office.officeId, value));
    return row?.name ?? value;
  }
  return value;
}

const personIdsSchema = z.array(z.uuid()).min(1).max(10);

const mergeSchema = z.object({
  keptPersonId: z.uuid(),
  retiredPersonIds: personIdsSchema,
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || null),
});

function parseMerge(rawInput: unknown) {
  const parsed = mergeSchema.safeParse(rawInput);
  const ids = parsed.success ? [parsed.data.keptPersonId, ...parsed.data.retiredPersonIds] : [];
  if (!parsed.success || new Set(ids).size !== ids.length) {
    throw new ValidationError({ personIds: 'Choose the person to keep and the others to merge into them, each once.' });
  }
  return parsed.data;
}

// Merges each in turn, so each plan sees the ones before it; a blocked one
// is planned but not applied.
async function mergeEach(tx: Transaction, actorUserAccountId: string, keptPersonId: string, retiredPersonIds: string[], note: string | null) {
  const ids = [keptPersonId, ...retiredPersonIds];
  // Stops a concurrent merge or undo of any of them from planning on stale rows.
  await tx.select({ id: person.personId }).from(person).where(inArray(person.personId, ids)).for('update');
  await tx.select({ id: professional.professionalId }).from(professional).where(inArray(professional.personId, ids)).for('update');
  const kept = (await summarize(tx, [keptPersonId])).get(keptPersonId);
  if (!kept) throw new NotFoundError('One of these people is not in the system.');
  const retired: RetiredPlan[] = [];
  const personMergeIds: string[] = [];
  for (const retiredPersonId of retiredPersonIds) {
    const { preview, steps } = await plan(tx, keptPersonId, retiredPersonId);
    retired.push(preview);
    if (preview.blockers.length > 0) continue;
    const [merge] = await tx
      .insert(personMerge)
      .values({ keptPersonId, retiredPersonId, note, mergedByUserAccountId: actorUserAccountId, mergedAt: new Date() })
      .returning({ personMergeId: personMerge.personMergeId });
    await apply(tx, merge!.personMergeId, steps);
    personMergeIds.push(merge!.personMergeId);
  }
  return { preview: { kept, retired } as MergePreview, personMergeIds };
}

class PreviewOnly extends Error {
  constructor(readonly preview: MergePreview) {
    super('preview');
  }
}

// Any staff member: runs the merges and rolls them back, so the preview is
// exactly what merging would do.
export async function previewMerge(db: Database, viewerUserAccountId: string, keptPersonId: string, retiredPersonIds: string[]): Promise<MergePreview> {
  const { keptPersonId: kept, retiredPersonIds: retired } = parseMerge({ keptPersonId, retiredPersonIds });
  try {
    await db.transaction(async (tx) => {
      throw new PreviewOnly((await mergeEach(tx, viewerUserAccountId, kept, retired, null)).preview);
    });
  } catch (error) {
    if (error instanceof PreviewOnly) return error.preview;
    throw error;
  }
  throw new Error('A merge preview must roll back.');
}

async function apply(tx: Transaction, personMergeId: string, steps: Step[]) {
  const changes: Array<typeof personMergeChange.$inferInsert> = [];
  for (const step of steps) {
    const { table, id, column, type } = step.target;
    const where =
      step.kind === 'move'
        ? sql`${sql.identifier(column)} = ${cast(step.from, type)}`
        : sql`${sql.identifier(id)} = ${step.rowId} and ${sql.identifier(column)} is not distinct from ${cast(step.from, type)}`;
    const moved = await tx.execute<{ id: string }>(
      sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${cast(step.to, type)} where ${where} returning ${sql.identifier(id)} as id`,
    );
    for (const row of moved.rows) {
      changes.push({ personMergeId, position: changes.length, tableName: table, columnName: column, rowId: row.id, fromValue: step.from, toValue: step.to });
    }
  }
  if (changes.length > 0) await tx.insert(personMergeChange).values(changes);
}

function conflictOnUniqueViolation(error: unknown): never {
  if (uniqueViolationConstraint(error)) {
    throw new ConflictError('merge_conflict', 'Something changed while this was saved that two records can’t share. Check both people and try again.');
  }
  throw error;
}

// Administrators only. All or none: one blocked record stops the whole merge.
export async function mergePeople(db: Database, actorUserAccountId: string, rawInput: unknown) {
  const { keptPersonId, retiredPersonIds, note } = parseMerge(rawInput);
  return db
    .transaction(async (tx) => {
      const { preview, personMergeIds } = await mergeEach(tx, actorUserAccountId, keptPersonId, retiredPersonIds, note);
      const blockers = preview.retired.flatMap((plan) => plan.blockers.map((blocker) => `${plan.person.displayName}: ${blocker}`));
      if (blockers.length > 0) {
        throw new ConflictError('merge_blocked', blockers.join(' '));
      }
      return { personMergeIds };
    })
    .catch(conflictOnUniqueViolation);
}

async function undoOne(tx: Transaction, actorUserAccountId: string, personMergeId: string) {
  const [merge] = await tx.select().from(personMerge).where(eq(personMerge.personMergeId, personMergeId)).for('update');
  if (!merge) throw new NotFoundError('That merge is not in the system.');
  if (merge.undoneAt) throw new ConflictError('already_undone', 'This merge has already been undone.');
  const people = await tx.select().from(person).where(inArray(person.personId, [merge.keptPersonId, merge.retiredPersonId])).for('update');
  const kept = people.find((row) => row.personId === merge.keptPersonId)!;
  if (kept.mergedIntoPersonId) {
    throw new ConflictError('kept_since_merged', `${kept.displayName} has since been merged into someone else. Undo that merge first.`);
  }
  const changes = await tx.select().from(personMergeChange).where(eq(personMergeChange.personMergeId, personMergeId)).orderBy(desc(personMergeChange.position));
  let restored = 0;
  for (const change of changes) {
    const target = CHANGEABLE.get(`${change.tableName}.${change.columnName}`);
    if (!target) throw new Error(`Unknown merge change ${change.tableName}.${change.columnName}`);
    const result = await tx.execute(
      sql`update ${sql.identifier(target.table)} set ${sql.identifier(target.column)} = ${cast(change.fromValue, target.type)}
        where ${sql.identifier(target.id)} = ${change.rowId} and ${sql.identifier(target.column)} is not distinct from ${cast(change.toValue, target.type)}`,
    );
    restored += result.rowCount ?? 0;
  }
  await tx.update(personMerge).set({ undoneByUserAccountId: actorUserAccountId, undoneAt: new Date() }).where(eq(personMerge.personMergeId, personMergeId));
  return { restored, leftAsIs: changes.length - restored };
}

// Administrators only. Undoes the merges last first, all or none. Puts back
// each value still as the merge left it; anything changed since stays.
export async function undoMerges(db: Database, actorUserAccountId: string, rawIds: unknown) {
  const parsed = personIdsSchema.safeParse(rawIds);
  if (!parsed.success) throw new ValidationError({ personMergeIds: 'Choose the merges to undo.' });
  return db
    .transaction(async (tx) => {
      let leftAsIs = 0;
      for (const personMergeId of [...parsed.data].reverse()) {
        leftAsIs += (await undoOne(tx, actorUserAccountId, personMergeId)).leftAsIs;
      }
      return { leftAsIs };
    })
    .catch(conflictOnUniqueViolation);
}

export async function listMerges(db: DatabaseOrTransaction, limit = 20) {
  const merges = await db
    .select({
      personMergeId: personMerge.personMergeId,
      keptPersonId: personMerge.keptPersonId,
      retiredPersonId: personMerge.retiredPersonId,
      note: personMerge.note,
      mergedAt: personMerge.mergedAt,
      mergedBy: userAccount.displayName,
      undoneAt: personMerge.undoneAt,
    })
    .from(personMerge)
    .innerJoin(userAccount, eq(personMerge.mergedByUserAccountId, userAccount.userAccountId))
    .orderBy(desc(personMerge.mergedAt))
    .limit(limit);
  const ids = [...new Set(merges.flatMap((merge) => [merge.keptPersonId, merge.retiredPersonId]))];
  const names = new Map(
    ids.length === 0
      ? []
      : (await db.select({ id: person.personId, name: person.displayName }).from(person).where(inArray(person.personId, ids))).map((row) => [row.id, row.name]),
  );
  return merges.map(({ keptPersonId, retiredPersonId, ...merge }) => ({
    ...merge,
    kept: { personId: keptPersonId, displayName: names.get(keptPersonId)! },
    retired: { personId: retiredPersonId, displayName: names.get(retiredPersonId)! },
  }));
}
