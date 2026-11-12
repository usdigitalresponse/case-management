// The review queue a batch at a time (../lists/batches.ts): filtered, counted
// and sorted in the database, each batch described as the whole queue is
// (./reviewQueue.ts). Filters read only the invoice row, so counts need no joins.
import { and, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { invoiceCaseNumber, isPrimaryIdentifierOf, joinedInvoiceCaseNumber, primaryIdentifier } from '../cases/caseNumberSql';
import { countyOrderKeys } from '../cases/counties';
import type { Database } from '../db/client';
import { inIds } from '../db/inIds';
import { caseTable, county, invoice, professional, userAccount } from '../db/schema';
import { selectInvoiceHeaders, type InvoiceHeader } from './invoiceDetail';
import { completionMarkedAt } from './invoiceEvents';
import { closeKey } from './caseNumbers';
import { sentCaseNumberCountsFor } from './caseNumberMatches';
import { getReviewSettings } from './reviewSettings';
import { workingDaysBetween } from './workingDays';
import { approvedTotalOf, finishedAt, holderOf, reviewerOf } from './queueSql';
import { describeQueue, scopeConditions, withMatches, type QueueRow, type QueueScope, type QueueView } from './reviewQueue';
import { APPROVED_INVOICE_STATUS_CODE, AWAITING_SIGN_OFF_INVOICE_STATUS_CODE, DECIDED_INVOICE_STATUS_CODES, IN_REVIEW_INVOICE_STATUS_CODES } from './invoiceStatusCodes';
import { afterCursor, cursorColumn, filledBatch, newestFirst, oldestFirst, oneBatch, orderByKeys, sortKey, withoutCursor, type Batch, type BatchRequest, type SortKey } from '../lists/batches';

// The pages' filters: To review's, Finished's, then Exports'; 'all' is everything.
// A person's: 'waiting' (in review) and 'done' (decided).
export const QUEUE_SHOWS = ['all', 'mine', 'unassigned', 'flagged', 'month', 'sign_off', 'decided', 'completed', 'approved', 'waiting', 'done'] as const;
export type QueueShow = (typeof QUEUE_SHOWS)[number];
// search: exact matches before close ones, each newest first.
export const QUEUE_SORTS = ['waiting', 'newest', 'finished', 'search'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

// county: a county's id, 'none' for invoices with none, or 'grouped' to sort by county first.
export interface QueueBatchRequest extends QueueScope {
  view: QueueView;
  q?: string;
  county?: string;
  show?: QueueShow;
  sort?: QueueSort;
  // The filters whose counts the page shows; none by default.
  counts?: QueueShow[];
  actorUserAccountId: string;
  now?: Date;
}

const statusCode = sql<string>`(select code from invoice_statuses where id = ${invoice.statusId})`;
const decided = sql`${statusCode} in (${sql.join(
  DECIDED_INVOICE_STATUS_CODES.map((code) => sql`${code}`),
  sql`, `,
)})`;
// Its own, else its case's.
const countyIdOf = sql<string | null>`coalesce(${invoice.countyId}, (select county_id from "case" where case_id = ${invoice.caseId}))`;
const caseNumber = invoiceCaseNumber;
// As a staff-entered invoice's wait is counted: from noon on the day it was received.
const waitingSince = sql`coalesce((${invoice.receivedOn} + time '12:00') at time zone 'UTC', ${invoice.submittedAt})`;

// searchMatch (./caseNumbers.ts) in SQL: 'exact' with names or case number containing the words.
function exactMatch(q: string): SQL | undefined {
  const words = q.trim().toLowerCase();
  if (!words) return undefined;
  const names = sql`lower(coalesce((select display_name from professional where professional_id = ${invoice.professionalId}), '') || ' ' ||
    coalesce((select display_name from user_account where user_account_id = ${invoice.submittedByUserAccountId}), ''))`;
  return sql`(strpos(${names}, ${words}) > 0 or coalesce(strpos(lower(${caseNumber}), ${words}) > 0, false))`;
}

// Filters worked out per invoice: their matches are found first, on the invoice
// table alone, since the planner can't guess how many pass and joins them badly.
const PER_INVOICE: QueueShow[] = ['mine', 'unassigned', 'month', 'decided', 'completed'];

async function showingIds(db: Database, show: QueueShow, base: SQL | undefined, showing: SQL | undefined | null) {
  if (!showing || !PER_INVOICE.includes(show)) return showing;
  const rows = await db.select({ invoiceId: invoice.invoiceId }).from(invoice).where(and(base, showing));
  return inIds(invoice.invoiceId, rows.map((row) => row.invoiceId));
}

// Rows read at a time while flags fill a batch: fewer rounds when few have flags.
const FILTERED_READ = 200;

// The view's invoices matching q (searchMatch in ./caseNumbers.ts): names or case number containing
// the words, or a close case number. Found once, with joins, so the batch, its counts and its
// summary look them up by id instead of each scanning again.
async function searchedIds(db: Database, request: QueueBatchRequest): Promise<SQL | undefined> {
  const words = request.q?.trim().toLowerCase();
  if (!words) return undefined;
  const key = closeKey(words);
  const number = joinedInvoiceCaseNumber;
  const names = sql`lower(coalesce(${professional.displayName}, '') || ' ' || coalesce(${userAccount.displayName}, ''))`;
  const rows = await db
    .select({ invoiceId: invoice.invoiceId })
    .from(invoice)
    .leftJoin(professional, eq(professional.professionalId, invoice.professionalId))
    .leftJoin(userAccount, eq(userAccount.userAccountId, invoice.submittedByUserAccountId))
    .leftJoin(caseTable, eq(caseTable.caseId, invoice.caseId))
    .leftJoin(primaryIdentifier, isPrimaryIdentifierOf(invoice.caseId))
    .where(
      and(
        ...scopeConditions(db, request.view, request),
        sql`(strpos(${names}, ${words}) > 0 or coalesce(strpos(lower(${number}), ${words}) > 0, false)
          ${key ? sql`or coalesce(strpos(case_number_close_key(${number}), ${key}) > 0, false)` : sql``})`,
      ),
    );
  return inIds(invoice.invoiceId, [...new Set(rows.map((row) => row.invoiceId))]);
}

// null: only code can tell (flags), so a batch is filled by reading on.
function shown(show: QueueShow, actorUserAccountId: string, now: Date): SQL | undefined | null {
  switch (show) {
    case 'mine':
      // The holder is always assigned, so the index on who is assigned narrows it first.
      return and(
        sql`${invoice.invoiceId} in (select invoice_id from invoice_review_assignment where assigned_user_account_id = ${actorUserAccountId} and ended_at is null)`,
        eq(holderOf(statusCode), actorUserAccountId),
      );
    case 'unassigned':
      return isNull(reviewerOf);
    case 'flagged':
      return null;
    case 'month':
      return sql`to_char(${finishedAt} at time zone 'UTC', 'YYYY-MM') = ${now.toISOString().slice(0, 7)}`;
    case 'sign_off':
      return sql`${statusCode} = ${AWAITING_SIGN_OFF_INVOICE_STATUS_CODE}`;
    case 'decided':
      return and(decided, isNull(completionMarkedAt));
    case 'completed':
      return and(decided, sql`${completionMarkedAt} is not null`);
    case 'approved':
      return sql`${statusCode} = ${APPROVED_INVOICE_STATUS_CODE}`;
    case 'waiting':
      return sql`${statusCode} in (${sql.join(IN_REVIEW_INVOICE_STATUS_CODES.map((code) => sql`${code}`), sql`, `)})`;
    case 'done':
      return decided;
    default:
      return undefined;
  }
}

function inCounty(choice: string | undefined): SQL | undefined {
  if (!choice || choice === 'grouped') return undefined;
  return choice === 'none' ? sql`${countyIdOf} is null` : sql`${countyIdOf} = ${choice}::uuid`;
}

const BY_COUNTY = countyOrderKeys(countyIdOf);

function sortKeys(sort: QueueSort, grouped: boolean, q: string): SortKey[] {
  const id = sortKey(sql`${invoice.invoiceId}`, 'uuid');
  const exact = exactMatch(q);
  const keys =
    sort === 'search' && exact
      ? [sortKey(sql`(not ${exact})::int`, 'integer'), newestFirst(invoice.submittedAt), id]
      : sort === 'newest' || sort === 'search'
      ? [newestFirst(invoice.submittedAt), id]
      : sort === 'finished'
        ? [newestFirst(finishedAt), id]
        : [oldestFirst(waitingSince), sortKey(sql`coalesce(${invoice.submittedAt}, '-infinity'::timestamptz)`, 'timestamptz'), id];
  return grouped ? [...BY_COUNTY, ...keys] : keys;
}

export interface LateInvoice {
  invoiceId: string;
  professionalDisplayName: string | null;
  submittedByDisplayName: string | null;
  submittedTotal: string;
  holderDisplayName: string | null;
  workingDaysWaiting: number;
}

export interface QueueSummary {
  // The counts asked for; null where only code can tell (flagged).
  counts: Partial<Record<QueueShow, number | null>>;
  // With the filter shown applied; null where only code can tell.
  counties: Array<{ countyId: string | null; displayName: string | null; count: number }> | null;
  // To review's: invoices past the waiting alert, and those the person looking is still entering.
  late: LateInvoice[];
  entering: QueueRow[];
  waitingAlertWorkingDays: number;
  // With q, in the county chosen: matches totalled apart, and every close one to warn about.
  search?: {
    exact: Totals;
    close: Totals & {
      invoices: Array<{
        invoiceId: string;
        professionalDisplayName: string | null;
        submittedByDisplayName: string | null;
        caseNumber: string | null;
        periodStart: string | null;
        periodEnd: string | null;
      }>;
    };
    people: number;
  };
  // With professionalId, whatever q is: every invoice of theirs, those sent this year, and those waiting now.
  person?: { total: number; thisYear: Totals & { approved: string }; waiting: Totals };
}

export interface Totals {
  count: number;
  requested: string;
}

export async function listReviewQueueBatch(
  db: Database,
  request: QueueBatchRequest,
  batch: BatchRequest,
): Promise<Batch<QueueRow> & { summary?: QueueSummary }> {
  const now = request.now ?? new Date();
  const base = and(...scopeConditions(db, request.view, request), await searchedIds(db, request));
  const showing = await showingIds(db, request.show ?? 'all', base, shown(request.show ?? 'all', request.actorUserAccountId, now));
  const keys = sortKeys(request.sort ?? 'waiting', request.county === 'grouped', request.q ?? '');
  const read = (after: string[] | null, limit: number) =>
    selectInvoiceHeaders(db, cursorColumn(keys))
      .where(and(base, showing ?? undefined, inCounty(request.county), afterCursor(keys, after)))
      .orderBy(...orderByKeys(keys))
      .limit(limit);
  const describe = async (rows: InvoiceHeader[]) => {
    const described = await describeQueue(db, rows, { now, actorUserAccountId: request.actorUserAccountId });
    const matchesOf = await sentCaseNumberCountsFor(db, described.map((row) => row.caseNumberCorrected ?? row.caseNumberAsTyped ?? row.caseNumber));
    return withMatches(described, matchesOf, request.q ?? '');
  };
  const result =
    showing === null
      ? await filledBatch(batch, read, describe, (row) => row.flags.length > 0, FILTERED_READ)
      : await oneBatch(batch, read).then(async ({ rows, next }) => ({ items: await describe(rows), next }));
  return batch.after ? result : { ...result, summary: await summarize(db, request, base, showing, now) };
}

const totals = (where?: SQL) => ({
  count: sql<number>`(count(*) filter (where ${where ?? sql`true`}))::int`,
  requested: sql<string>`coalesce(sum(${invoice.submittedTotal}) filter (where ${where ?? sql`true`}), 0)::numeric(12,2)::text`,
});

async function searchSummary(db: Database, q: string, where: SQL | undefined): Promise<NonNullable<QueueSummary['search']>> {
  const exact = exactMatch(q)!;
  const [[row], close] = await Promise.all([
    db
      .select({
        exactCount: totals(exact).count,
        exactRequested: totals(exact).requested,
        closeCount: totals(sql`not ${exact}`).count,
        closeRequested: totals(sql`not ${exact}`).requested,
        people: sql<number>`count(distinct ${invoice.professionalId})::int`,
      })
      .from(invoice)
      .where(where),
    db
      .select({
        invoiceId: invoice.invoiceId,
        professionalDisplayName: professional.displayName,
        submittedByDisplayName: userAccount.displayName,
        caseNumber,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
      })
      .from(invoice)
      .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
      .leftJoin(userAccount, eq(invoice.submittedByUserAccountId, userAccount.userAccountId))
      .where(and(where, sql`not ${exact}`))
      .orderBy(sql`${invoice.submittedAt} desc nulls last`, invoice.invoiceId),
  ]);
  return {
    exact: { count: row!.exactCount, requested: row!.exactRequested },
    close: { count: row!.closeCount, requested: row!.closeRequested, invoices: close },
    people: row!.people,
  };
}

async function personSummary(db: Database, base: SQL | undefined, now: Date): Promise<NonNullable<QueueSummary['person']>> {
  const thisYear = sql`to_char(${invoice.submittedAt} at time zone 'UTC', 'YYYY') = ${String(now.getUTCFullYear())}`;
  const waiting = shown('waiting', '', now)!;
  const [row] = await db
    .select({
      yearCount: totals(thisYear).count,
      yearRequested: totals(thisYear).requested,
      yearApproved: sql<string>`coalesce(sum(${approvedTotalOf}) filter (where ${thisYear}), 0)::numeric(12,2)::text`,
      waitingCount: totals(waiting).count,
      waitingRequested: totals(waiting).requested,
      total: sql<number>`count(*)::int`,
    })
    .from(invoice)
    .where(base);
  return {
    total: row!.total,
    thisYear: { count: row!.yearCount, requested: row!.yearRequested, approved: row!.yearApproved },
    waiting: { count: row!.waitingCount, requested: row!.waitingRequested },
  };
}

async function countShows<Show extends QueueShow>(db: Database, base: SQL | undefined, shows: Show[], actorUserAccountId: string, now: Date) {
  const [row] = await db
    .select(Object.fromEntries(shows.map((show) => [show, sql<number>`(count(*) filter (where ${shown(show, actorUserAccountId, now) ?? sql`true`}))::int`])))
    .from(invoice)
    .where(base);
  return row as Record<Show, number>;
}

// The sidebar's: invoices to review, and those waiting on the person looking.
export async function openQueueCounts(db: Database, actorUserAccountId: string): Promise<{ all: number; mine: number }> {
  return countShows(db, and(...scopeConditions(db, 'open', {})), ['all', 'mine'], actorUserAccountId, new Date());
}

async function summarize(db: Database, request: QueueBatchRequest, base: SQL | undefined, showing: SQL | undefined | null, now: Date): Promise<QueueSummary> {
  const countable = (request.counts ?? []).filter((show) => show !== 'flagged');
  const settings = await getReviewSettings(db);
  const [tagCounts, counties, entering, late] = await Promise.all([
    countable.length > 0 ? countShows(db, base, countable, request.actorUserAccountId, now) : Promise.resolve({}),
    showing === null
      ? Promise.resolve(null)
      : db
          .select({ countyId: county.countyId, displayName: county.displayName, count: count() })
          .from(invoice)
          .leftJoin(county, eq(county.countyId, countyIdOf))
          .where(and(base, showing))
          .groupBy(county.countyId, county.displayName),
    request.view === 'open'
      ? selectInvoiceHeaders(db).where(
          and(
            base,
            eq(invoice.enteredInReview, true),
            eq(reviewerOf, request.actorUserAccountId),
            sql`exists (select 1 from invoice_approval_chain c where c.invoice_id = ${invoice.invoiceId} and c.superseded_at is null and c.submission_snapshot is null)`,
          ),
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof selectInvoiceHeaders>>),
    request.view === 'open'
      ? db
          .select({
            invoiceId: invoice.invoiceId,
            professionalDisplayName: professional.displayName,
            submittedByDisplayName: userAccount.displayName,
            submittedTotal: invoice.submittedTotal,
            holderDisplayName: sql<string | null>`(select display_name from user_account where user_account_id = ${holderOf(statusCode)})`,
            waitingSince: sql<string>`${waitingSince}`.mapWith((value: string) => new Date(value)),
          })
          .from(invoice)
          .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
          .leftJoin(userAccount, eq(invoice.submittedByUserAccountId, userAccount.userAccountId))
          // Working days never outnumber calendar days, so none waiting fewer can be late.
          .where(and(base, sql`${waitingSince} < ${new Date(now.getTime() - settings.waitingAlertWorkingDays * 86_400_000)}`))
          .orderBy(sql`${waitingSince}`)
      : Promise.resolve([]),
  ]);
  const enteringRows = await describeQueue(db, entering.map(withoutCursor), { now, actorUserAccountId: request.actorUserAccountId });
  const [search, person] = await Promise.all([
    request.q?.trim() ? searchSummary(db, request.q, and(base, inCounty(request.county))) : undefined,
    request.professionalId ? personSummary(db, and(...scopeConditions(db, request.view, request)), now) : undefined,
  ]);
  return {
    ...(search && { search }),
    ...(person && { person }),
    counts: Object.fromEntries((request.counts ?? []).map((show) => [show, show === 'flagged' ? null : (tagCounts as Record<string, number>)[show]!])),
    counties,
    late: late
      .map(({ waitingSince: since, ...row }) => ({ ...row, workingDaysWaiting: workingDaysBetween(since, now) }))
      .filter((row) => row.workingDaysWaiting > settings.waitingAlertWorkingDays),
    entering: withMatches(enteringRows, () => ({ same: 0, close: 0 }), ''),
    waitingAlertWorkingDays: settings.waitingAlertWorkingDays,
  };
}
