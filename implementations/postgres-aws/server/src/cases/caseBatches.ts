// Cases a batch at a time (../lists/batches.ts), by client name: All cases,
// Clients, a stage's cases and the case pickers' search. Filters read only
// the case row, so counts need no joins.
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseStatuses, caseTable, county, person } from '../db/schema';
import { afterCursor, cursorColumn, oneBatch, orderByKeys, sortKey, type Batch, type BatchRequest, type SortKey } from '../lists/batches';
import { CASE_STAGES, caseStageExpression, type CaseStage } from './caseStage';
import { loadCaseListExtras, type CaseListExtras } from './caseSummaries';

export const CASE_SHOWS = ['all', 'open', 'closed'] as const;
export type CaseShow = (typeof CASE_SHOWS)[number];

// q: client name, case number or who works on it; county: a county's id, 'none' or 'grouped'.
export interface CaseBatchRequest {
  show?: CaseShow;
  stage?: CaseStage;
  county?: string;
  q?: string;
}

// clientDisplayName is joined in for display only: client_id is a
// compatibility field, case_participant is authoritative (model/schema.yaml).
export const caseColumnsWithClientName = {
  caseId: caseTable.caseId,
  clientId: caseTable.clientId,
  clientDisplayName: person.displayName,
  countyId: caseTable.countyId,
  countyDisplayName: county.displayName,
  externalReference: caseTable.externalReference,
  caseCategoryId: caseTable.caseCategoryId,
  statusId: caseTable.statusId,
  statusDisplayName: caseStatuses.displayName,
  openedOn: caseTable.openedOn,
  closedOn: caseTable.closedOn,
  organizationId: caseTable.organizationId,
  officeId: caseTable.officeId,
  jurisdictionId: caseTable.jurisdictionId,
  preferredLanguageId: caseTable.preferredLanguageId,
  stage: caseStageExpression,
};

const clientName = sql<string | null>`(select display_name from person where person_id = ${caseTable.clientId})`;
// As loadCaseNumbers: its primary identifier, else its external reference.
const caseNumber = sql<string | null>`coalesce((select value from case_identifier where case_id = ${caseTable.caseId} and is_primary limit 1), ${caseTable.externalReference})`;
const workers = sql<string>`coalesce((select string_agg(p.display_name, ' ') from case_assignment a
  join professional p on p.professional_id = a.professional_id where a.case_id = ${caseTable.caseId} and a.ended_at is null), '')`;

function shown(show: CaseShow): SQL | undefined {
  return show === 'open' ? isNull(caseTable.closedOn) : show === 'closed' ? isNotNull(caseTable.closedOn) : undefined;
}

function filters(request: CaseBatchRequest): SQL | undefined {
  const words = request.q?.trim().toLowerCase();
  return and(
    request.stage ? sql`${caseStageExpression} = ${request.stage}` : undefined,
    words ? sql`strpos(lower(coalesce(${clientName}, '') || ' ' || coalesce(${caseNumber}, '') || ' ' || ${workers}), ${words}) > 0` : undefined,
  );
}

function inCounty(choice: string | undefined): SQL | undefined {
  if (!choice || choice === 'grouped') return undefined;
  return choice === 'none' ? isNull(caseTable.countyId) : eq(caseTable.countyId, choice);
}

// As the county list orders them: settings, then counties by name, then retired ones, then none.
const countyColumn = (column: string) => sql.raw(`(select ${column} from county where county_id = `);
const BY_COUNTY: SortKey[] = [
  sortKey(sql`(${caseTable.countyId} is null)::int`, 'integer'),
  sortKey(sql`(not coalesce(${countyColumn('active')}${caseTable.countyId}), true))::int`, 'integer'),
  sortKey(sql`coalesce(${countyColumn('is_county')}${caseTable.countyId}), true)::int`, 'integer'),
  sortKey(sql`coalesce(${countyColumn('display_name')}${caseTable.countyId}), '')`, 'text'),
  sortKey(sql`coalesce(${caseTable.countyId}, '00000000-0000-0000-0000-000000000000'::uuid)`, 'uuid'),
];
const BY_CLIENT: SortKey[] = [sortKey(sql`coalesce(${clientName}, '')`, 'text'), sortKey(sql`${caseTable.caseId}`, 'uuid')];

export type CaseListRow = Awaited<ReturnType<typeof selectCases>>[number] & CaseListExtras;

function selectCases(db: DatabaseOrTransaction, keys: SortKey[]) {
  return db
    .select({ ...caseColumnsWithClientName, cursor: cursorColumn(keys) })
    .from(caseTable)
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
    .leftJoin(county, eq(caseTable.countyId, county.countyId));
}

export interface CaseSummary {
  // Every case, whatever the filters: all, open and closed.
  counts: Record<CaseShow, number>;
  // With the filters applied.
  counties: Array<{ countyId: string | null; displayName: string | null; count: number }>;
}

// summarized: with the summary on the first batch.
export async function listCaseBatch(
  db: DatabaseOrTransaction,
  request: CaseBatchRequest,
  batch: BatchRequest,
  { summarized = true } = {},
): Promise<Batch<Omit<CaseListRow, 'cursor'>> & { summary?: CaseSummary }> {
  const keys = request.county === 'grouped' ? [...BY_COUNTY, ...BY_CLIENT] : BY_CLIENT;
  const where = and(filters(request), shown(request.show ?? 'all'));
  const { rows, next } = await oneBatch(batch, (after, limit) =>
    selectCases(db, keys)
      .where(and(where, inCounty(request.county), afterCursor(keys, after)))
      .orderBy(...orderByKeys(keys))
      .limit(limit),
  );
  const extras = await loadCaseListExtras(db, rows.map((row) => row.caseId));
  const items = rows.map(({ cursor: _cursor, ...row }) => ({ ...row, ...extras.get(row.caseId)! }));
  if (batch.after || !summarized) return { items, next };
  const [counts, counties] = await Promise.all([
    caseCounts(db),
    db
      .select({ countyId: county.countyId, displayName: county.displayName, count: sql<number>`count(*)::int` })
      .from(caseTable)
      .leftJoin(county, eq(caseTable.countyId, county.countyId))
      .where(where)
      .groupBy(county.countyId, county.displayName),
  ]);
  return { items, next, summary: { counts: { all: counts.all, open: counts.open, closed: counts.closed }, counties } };
}

// Every case's: all, open and closed, and by organization (for Organizations).
export async function caseCounts(db: DatabaseOrTransaction): Promise<Record<CaseShow, number> & { byOrganization: Record<string, number> }> {
  const [[row], organizations] = await Promise.all([
    db
      .select({
        all: sql<number>`count(*)::int`,
        open: sql<number>`(count(*) filter (where ${shown('open')}))::int`,
        closed: sql<number>`(count(*) filter (where ${shown('closed')}))::int`,
      })
      .from(caseTable),
    db
      .select({ organizationId: caseTable.organizationId, count: sql<number>`count(*)::int` })
      .from(caseTable)
      .where(isNotNull(caseTable.organizationId))
      .groupBy(caseTable.organizationId),
  ]);
  return { ...row!, byOrganization: Object.fromEntries(organizations.map((org) => [org.organizationId!, org.count])) };
}

const OVERVIEW_SHOWN = 3;

// The Case overview: how many cases, and each stage's count and first few by client.
export async function caseOverview(db: DatabaseOrTransaction) {
  const stages = [...CASE_STAGES];
  const [counts, byStage, ...firsts] = await Promise.all([
    caseCounts(db),
    db
      .select({ stage: caseStageExpression, count: sql<number>`count(*)::int` })
      .from(caseTable)
      .where(isNull(caseTable.closedOn))
      .groupBy(caseStageExpression),
    ...stages.map((stage) => listCaseBatch(db, { stage }, { limit: OVERVIEW_SHOWN, after: null }, { summarized: false })),
  ]);
  const countOf = new Map(byStage.map((row) => [row.stage, row.count]));
  return {
    all: counts.all,
    open: counts.open,
    stages: stages.map((stage, index) => ({ stage, count: countOf.get(stage) ?? 0, cases: firsts[index]!.items })),
  };
}
