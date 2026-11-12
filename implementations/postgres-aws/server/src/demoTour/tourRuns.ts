// Guided tour runs and their removal (docs/api.md "Guided tour"). A run
// records the cases, invoices, requests and people it made or its visitor
// added; a day after it starts, those go with everything that references
// them, found through the database's own foreign keys. Demo servers only:
// the one exception to keeping history, for synthetic tour material alone.
import type { Request } from 'express';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db as defaultDb, type Database, type DatabaseOrTransaction } from '../db/client';
import { auditEvent, demoTourRecord, demoTourRun, document } from '../db/schema';
import type { DocumentStore } from '../imports/documentStore';

export type TourRecordTable = 'case' | 'invoice' | 'preauthorization_request' | 'professional';

export const TOUR_RUN_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function recordTourRecords(
  db: DatabaseOrTransaction,
  runId: string,
  records: Array<{ table: TourRecordTable; id: string }>,
): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(demoTourRecord)
    .values(records.map(({ table, id }) => ({ demoTourRunId: runId, tableName: table, recordId: id })))
    .onConflictDoNothing();
}

// What a visitor adds while their session holds a run: the run lives in their
// own cookie, so others signed in as the same demo account aren't tagged.
export async function tagTourRecord(req: Request, table: TourRecordTable, id: string | undefined, db: Database = defaultDb): Promise<void> {
  const runId = (req.session?.tour as { runId?: string } | undefined)?.runId;
  if (!runId || !id) return;
  try {
    // A session from before runs were recorded has no row; nothing is tagged then.
    await db.execute(sql`
      insert into ${demoTourRecord} (demo_tour_run_id, table_name, record_id)
      select ${runId}::uuid, ${table}, ${id}::uuid
      where exists (select 1 from ${demoTourRun} where demo_tour_run_id = ${runId}::uuid)
      on conflict do nothing`);
  } catch (error) {
    // Tagging is housekeeping; the visitor's change has already been made.
    // eslint-disable-next-line no-console
    console.error('Tour record tagging failed', error);
  }
}

interface ForeignKey {
  child: string;
  column: string;
  parent: string;
}

async function schemaGraph(tx: DatabaseOrTransaction) {
  const keys = await tx.execute<{ child: string; column: string; parent: string }>(sql`
    select con.conrelid::regclass::text as child, a.attname::text as column, con.confrelid::regclass::text as parent
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f' and array_length(con.conkey, 1) = 1`);
  const primaries = await tx.execute<{ table: string; column: string }>(sql`
    select c.oid::regclass::text as table, a.attname::text as column
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum = i.indkey[0]
    where i.indisprimary and i.indnatts = 1`);
  // regclass quotes reserved names ("case"); use the bare name throughout.
  const bare = (name: string) => name.replace(/^"|"$/g, '');
  const foreignKeys: ForeignKey[] = keys.rows
    .map((row) => ({ child: bare(row.child), column: row.column, parent: bare(row.parent) }))
    .filter((key) => !key.child.startsWith('demo_tour_'));
  const primaryKey = new Map(primaries.rows.map((row) => [bare(row.table), row.column]));
  return { foreignKeys, primaryKey };
}

const ids = (values: Iterable<string>) => sql`${`{${[...values].join(',')}}`}::uuid[]`;
const table = (name: string) => sql.identifier(name);

class KeepRun extends Error {}

// Everything under the run's records, checked to stay within the run.
async function collectRun(tx: DatabaseOrTransaction, runId: string) {
  const { foreignKeys, primaryKey } = await schemaGraph(tx);
  const tagged = await tx.select().from(demoTourRecord).where(eq(demoTourRecord.demoTourRunId, runId));
  const roots = new Map<string, Set<string>>();
  const addRoot = (name: string, id: string) => roots.set(name, (roots.get(name) ?? new Set()).add(id));
  for (const record of tagged) addRoot(record.tableName, record.recordId);
  // A run's case comes with its own client, and an added person with their person record.
  const rootIds = (name: string) => [...(roots.get(name) ?? [])];
  if (rootIds('case').length > 0) {
    const clients = await tx.execute<{ id: string }>(sql`select client_id as id from "case" where case_id = any(${ids(rootIds('case'))}) and client_id is not null`);
    for (const row of clients.rows) addRoot('person', row.id);
  }
  if (rootIds('professional').length > 0) {
    const people = await tx.execute<{ id: string }>(sql`select person_id as id from professional where professional_id = any(${ids(rootIds('professional'))})`);
    for (const row of people.rows) addRoot('person', row.id);
  }

  const found = new Map<string, Set<string>>();
  const queue: Array<[string, string[]]> = [];
  const add = (name: string, values: string[]) => {
    const set = found.get(name) ?? new Set<string>();
    found.set(name, set);
    const fresh = values.filter((value) => !set.has(value));
    for (const value of fresh) set.add(value);
    if (fresh.length > 0) queue.push([name, fresh]);
  };
  for (const [name, set] of roots) {
    const pk = primaryKey.get(name)!;
    // Only records that still exist.
    // eslint-disable-next-line no-await-in-loop
    const existing = await tx.execute<{ id: string }>(sql`select ${table(pk)} as id from ${table(name)} where ${table(pk)} = any(${ids(set)})`);
    add(name, existing.rows.map((row) => row.id));
  }
  while (queue.length > 0) {
    const [parent, parentIds] = queue.shift()!;
    for (const key of foreignKeys.filter((candidate) => candidate.parent === parent)) {
      const pk = primaryKey.get(key.child);
      if (!pk) throw new KeepRun(`${key.child} has no single primary key`);
      // eslint-disable-next-line no-await-in-loop
      const children = await tx.execute<{ id: string }>(
        sql`select ${table(pk)} as id from ${table(key.child)} where ${table(key.column)} = any(${ids(parentIds)})`,
      );
      add(key.child, children.rows.map((row) => row.id));
    }
  }

  // Never another visitor's records: no case, person or account beyond the
  // run's own, an invoice or request only if the run's or on its case, and
  // nothing left pointing at an invoice, case or request outside the run.
  for (const name of ['case', 'person', 'professional', 'user_account']) {
    const outside = [...(found.get(name) ?? [])].filter((id) => !roots.get(name)?.has(id));
    if (outside.length > 0) throw new KeepRun(`it reaches ${outside.length} ${name} record(s) not made by the tour`);
  }
  const runCases = [...(found.get('case') ?? [])];
  for (const name of ['invoice', 'preauthorization_request']) {
    const reached = [...(found.get(name) ?? [])].filter((id) => !roots.get(name)?.has(id));
    if (reached.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    const elsewhere = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from ${table(name)}
      where ${table(primaryKey.get(name)!)} = any(${ids(reached)}) and (case_id is null or case_id <> all(${ids(runCases)}))`);
    if ((elsewhere.rows[0]?.n ?? 0) > 0) throw new KeepRun(`it reaches ${name} records on other cases`);
  }
  for (const [name, set] of found) {
    for (const key of foreignKeys.filter((candidate) => candidate.child === name && ['case', 'invoice', 'preauthorization_request'].includes(candidate.parent))) {
      // eslint-disable-next-line no-await-in-loop
      const loose = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from ${table(name)}
        where ${table(primaryKey.get(name)!)} = any(${ids(set)})
          and ${table(key.column)} is not null and ${table(key.column)} <> all(${ids(found.get(key.parent) ?? [])})`);
      if ((loose.rows[0]?.n ?? 0) > 0) throw new KeepRun(`its ${name} records point at a ${key.parent} outside the tour`);
    }
  }
  return { found, foreignKeys, primaryKey };
}

// Children before parents; a table referencing itself is one statement.
function deletionOrder(found: Map<string, Set<string>>, foreignKeys: ForeignKey[]): string[] {
  const pending = new Set(found.keys());
  const order: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(
      (name) => !foreignKeys.some((key) => key.parent === name && key.child !== name && pending.has(key.child)),
    );
    if (ready.length === 0) throw new KeepRun(`its tables reference each other in a cycle: ${[...pending].join(', ')}`);
    for (const name of ready) {
      pending.delete(name);
      order.push(name);
    }
  }
  return order;
}

export async function removeTourRun(db: Database, store: DocumentStore, runId: string): Promise<{ removed: boolean; keptReason?: string }> {
  const [run] = await db.select().from(demoTourRun).where(eq(demoTourRun.demoTourRunId, runId));
  if (!run) return { removed: false };
  let files: string[];
  try {
    files = await db.transaction(async (tx) => {
      const { found, foreignKeys, primaryKey } = await collectRun(tx, runId);
      // Files the run's rows point at, removed below once nothing else does.
      const documentIds = new Set<string>();
      for (const key of foreignKeys.filter((candidate) => candidate.parent === 'document' && found.has(candidate.child))) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await tx.execute<{ id: string }>(sql`
          select ${table(key.column)} as id from ${table(key.child)}
          where ${table(primaryKey.get(key.child)!)} = any(${ids(found.get(key.child)!)}) and ${table(key.column)} is not null`);
        for (const row of rows.rows) documentIds.add(row.id);
      }
      for (const name of deletionOrder(found, foreignKeys)) {
        // eslint-disable-next-line no-await-in-loop
        await tx.execute(sql`delete from ${table(name)} where ${table(primaryKey.get(name)!)} = any(${ids(found.get(name)!)})`);
      }
      const allIds = [...found.values()].flatMap((set) => [...set]);
      if (allIds.length > 0) await tx.delete(auditEvent).where(sql`${auditEvent.entityId} = any(${ids(allIds)})`);
      const removedFiles: string[] = [];
      for (const documentId of documentIds) {
        const references = foreignKeys
          .filter((key) => key.parent === 'document')
          .map((key) => sql`exists (select 1 from ${table(key.child)} where ${table(key.column)} = ${documentId}::uuid)`);
        // Only files the run added, and only once nothing else uses them.
        const [gone] = (
          // eslint-disable-next-line no-await-in-loop
          await tx.execute<{ storage_reference: string; content_deleted_at: Date | null }>(sql`
            delete from ${document}
            where document_id = ${documentId}::uuid and recorded_at >= ${run.startedAt.toISOString()}::timestamptz
              and not (${sql.join(references, sql` or `)})
            returning storage_reference, content_deleted_at`)
        ).rows;
        if (gone && !gone.content_deleted_at) removedFiles.push(gone.storage_reference);
      }
      await tx.delete(demoTourRun).where(eq(demoTourRun.demoTourRunId, runId));
      return removedFiles;
    });
  } catch (error) {
    if (!(error instanceof KeepRun)) throw error;
    await db.update(demoTourRun).set({ keptReason: error.message }).where(eq(demoTourRun.demoTourRunId, runId));
    return { removed: false, keptReason: error.message };
  }
  // After commit, so a failed transaction never loses a file; startup removes any left.
  for (const storageReference of files) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(storageReference);
  }
  return { removed: true };
}

// The hourly sweep: runs started more than a day ago, a few at a time.
export async function sweepTourRuns(db: Database, store: DocumentStore, now = new Date()): Promise<{ removed: number; kept: number }> {
  const due = await db
    .select({ id: demoTourRun.demoTourRunId })
    .from(demoTourRun)
    .where(and(isNull(demoTourRun.keptReason), lt(demoTourRun.startedAt, new Date(now.getTime() - TOUR_RUN_LIFETIME_MS))))
    .orderBy(demoTourRun.startedAt)
    .limit(50);
  let removed = 0;
  let kept = 0;
  for (const { id } of due) {
    // eslint-disable-next-line no-await-in-loop
    const result = await removeTourRun(db, store, id);
    if (result.removed) removed += 1;
    if (result.keptReason) {
      kept += 1;
      // eslint-disable-next-line no-console
      console.warn(`Guided tour run ${id} kept: ${result.keptReason}`);
    }
  }
  return { removed, kept };
}
