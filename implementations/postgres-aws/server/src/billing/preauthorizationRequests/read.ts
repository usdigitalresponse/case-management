import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type DatabaseOrTransaction } from '../../db/client';
import { caseTable, county, person, preauthorizationDecision, preauthorizationQuestion, preauthorizationRequest, preauthorizationRequestOutcomes, preauthorizationRequestStatuses, professional, professionalKinds, userAccount } from '../../db/schema';
import { ForbiddenError, NotFoundError } from '../../errors';
import { isStaffAccount, type PortalActor } from '../../portal/portalActor';
import { loadCaseNumbers } from '../invoiceDetail';
import { loadPreauthorizationSummariesByCase } from '../preauthorizations';
import { afterCursor, cursorColumn, newestFirst, oneBatch, orderByKeys, sortKey, withoutCursor, type BatchRequest } from '../../lists/batches';
import { OPEN_STATUSES } from './requestRules';
import { listLinkedDocuments, providerDocumentStatus } from './providerRecords';

// --- reading ---------------------------------------------------------------


export const requester = alias(userAccount, 'requester');
const decider = alias(userAccount, 'decider');
const requestedFor = alias(person, 'requested_for');
export const provider = alias(professional, 'provider');

const requestColumns = {
  preauthorizationRequestId: preauthorizationRequest.preauthorizationRequestId,
  requestNumber: preauthorizationRequest.requestNumber,
  caseId: preauthorizationRequest.caseId,
  countyName: county.displayName,
  countyId: county.countyId,
  professionalId: preauthorizationRequest.professionalId,
  providerName: provider.displayName,
  proposedDetails: preauthorizationRequest.proposedDetails,
  kindName: professionalKinds.displayName,
  serviceDescription: preauthorizationRequest.serviceDescription,
  rateBasis: preauthorizationRequest.rateBasis,
  requestedRate: preauthorizationRequest.requestedRate,
  estimatedQuantity: preauthorizationRequest.estimatedQuantity,
  requestedAmount: preauthorizationRequest.requestedAmount,
  justification: preauthorizationRequest.justification,
  statusCode: preauthorizationRequestStatuses.code,
  statusName: preauthorizationRequestStatuses.displayName,
  outcomeCode: preauthorizationRequestOutcomes.code,
  outcomeName: preauthorizationRequestOutcomes.displayName,
  decisionReason: preauthorizationRequest.decisionReason,
  // Not for one case, the decision is kept on the request alone.
  notForCase: preauthorizationRequest.notForCase,
  approvedAmount: sql<string | null>`coalesce(${preauthorizationDecision.approvedAmount}, ${preauthorizationRequest.approvedAmount})`,
  approvedHourlyRate: sql<string | null>`coalesce(${preauthorizationDecision.approvedHourlyRate}, ${preauthorizationRequest.approvedHourlyRate})`,
  requestedByUserAccountId: preauthorizationRequest.requestedByUserAccountId,
  requestedByName: requester.displayName,
  requestedForName: requestedFor.displayName,
  receivedVia: preauthorizationRequest.receivedVia,
  receivedAt: preauthorizationRequest.receivedAt,
  decidedByName: decider.displayName,
  decidedAt: preauthorizationRequest.decidedAt,
  withdrawnAt: preauthorizationRequest.withdrawnAt,
};

// cursor: a list's (../../lists/batches.ts).
function selectRequests(db: DatabaseOrTransaction, cursor?: SQL<string[]>) {
  return db
    .select({ ...requestColumns, cursor: cursor ?? sql<string[] | null>`null` })
    .from(preauthorizationRequest)
    .innerJoin(preauthorizationRequestStatuses, eq(preauthorizationRequest.statusId, preauthorizationRequestStatuses.id))
    .leftJoin(preauthorizationRequestOutcomes, eq(preauthorizationRequest.outcomeId, preauthorizationRequestOutcomes.id))
    .leftJoin(preauthorizationDecision, eq(preauthorizationRequest.preauthorizationDecisionId, preauthorizationDecision.preauthorizationDecisionId))
    .leftJoin(caseTable, eq(preauthorizationRequest.caseId, caseTable.caseId))
    .leftJoin(county, eq(county.countyId, sql`coalesce(${caseTable.countyId}, ${preauthorizationRequest.countyId})`))
    .leftJoin(provider, eq(preauthorizationRequest.professionalId, provider.professionalId))
    .leftJoin(professionalKinds, eq(preauthorizationRequest.professionalKindId, professionalKinds.id))
    .innerJoin(requester, eq(preauthorizationRequest.requestedByUserAccountId, requester.userAccountId))
    .leftJoin(requestedFor, eq(preauthorizationRequest.requestedForPersonId, requestedFor.personId))
    .leftJoin(decider, eq(preauthorizationRequest.decidedByUserAccountId, decider.userAccountId));
}

function fetchRequests(db: DatabaseOrTransaction, where: SQL | undefined) {
  return selectRequests(db)
    .where(where)
    .orderBy(desc(preauthorizationRequest.receivedAt), desc(preauthorizationRequest.requestNumber));
}

const NEWEST_FIRST = [newestFirst(preauthorizationRequest.receivedAt), sortKey(sql`${preauthorizationRequest.preauthorizationRequestId}`, 'uuid')];

// Latest received first, a batch at a time.
async function requestBatch(db: DatabaseOrTransaction, where: SQL | undefined, batch: BatchRequest) {
  const { rows, next } = await oneBatch(batch, (after, limit) =>
    selectRequests(db, cursorColumn(NEWEST_FIRST))
      .where(and(where, afterCursor(NEWEST_FIRST, after)))
      .orderBy(...orderByKeys(NEWEST_FIRST))
      .limit(limit),
  );
  return { items: await withCaseFacts(db, rows), next };
}

type RequestRow = Omit<Awaited<ReturnType<typeof fetchRequests>>[number], 'cursor'>;

export interface RequestListFilter {
  status?: string;
  countyId?: string;
  caseId?: string;
  // Received on or after / before, as dates.
  from?: string;
  to?: string;
}

// Adds case numbers and each matched provider's current limit.
async function withCaseFacts(db: DatabaseOrTransaction, rows: RequestRow[]) {
  const caseIds = [...new Set(rows.flatMap((row) => (row.caseId ? [row.caseId] : [])))];
  // Every matched provider on each case, so each has a limit to show.
  const professionals = [...new Set(rows.flatMap((row) => (row.professionalId ? [row.professionalId] : [])))];
  const [numbers, summaries] = await Promise.all([loadCaseNumbers(db, caseIds), loadPreauthorizationSummariesByCase(db, caseIds, professionals)]);
  return rows.map((row) => {
    const proposed = (row.proposedDetails ?? {}) as { case?: { caseNumber?: string; countyId?: string | null }; provider?: { name?: string } };
    const limit = row.caseId && row.professionalId ? ((summaries.get(row.caseId) ?? []).find((s) => s.professionalId === row.professionalId) ?? null) : null;
    return {
      ...row,
      caseNumber: row.caseId ? (numbers.get(row.caseId)?.caseNumber ?? null) : null,
      proposedCaseNumber: proposed.case?.caseNumber ?? null,
      proposedCountyId: proposed.case?.countyId ?? null,
      proposedProviderName: proposed.provider?.name ?? null,
      limit,
    };
  });
}

export type PreauthorizationRequestView = Awaited<ReturnType<typeof withCaseFacts>>[number];

// Pre-authorizations' filters (design K54): In review and Decided, each several statuses.
export const REQUEST_STATUS_GROUPS: Record<string, string[]> = {
  in_review: ['submitted', 'info_requested'],
  decided: ['approved', 'not_needed', 'denied', 'withdrawn'],
};

// Per status and filter, whichever one is listed.
export type RequestStatusCounts = Record<'submitted' | 'info_requested' | 'approved' | 'not_needed' | 'denied' | 'withdrawn' | 'in_review' | 'decided' | 'all', number>;

async function countByStatus(db: DatabaseOrTransaction, where: SQL | undefined): Promise<RequestStatusCounts> {
  const rows = await db
    .select({ code: preauthorizationRequestStatuses.code, count: sql<number>`count(*)::int` })
    .from(preauthorizationRequest)
    .innerJoin(preauthorizationRequestStatuses, eq(preauthorizationRequest.statusId, preauthorizationRequestStatuses.id))
    .leftJoin(caseTable, eq(preauthorizationRequest.caseId, caseTable.caseId))
    .where(where)
    .groupBy(preauthorizationRequestStatuses.code);
  const of = (code: string) => rows.find((row) => row.code === code)?.count ?? 0;
  return {
    submitted: of('submitted'),
    info_requested: of('info_requested'),
    approved: of('approved'),
    not_needed: of('not_needed'),
    denied: of('denied'),
    withdrawn: of('withdrawn'),
    in_review: REQUEST_STATUS_GROUPS.in_review!.reduce((sum, code) => sum + of(code), 0),
    decided: REQUEST_STATUS_GROUPS.decided!.reduce((sum, code) => sum + of(code), 0),
    all: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

// A batch at a time (../../lists/batches.ts), with the status counts on the first.
export async function listPreauthorizationRequests(db: DatabaseOrTransaction, actorUserAccountId: string, filter: RequestListFilter, batch: BatchRequest) {
  if (!(await isStaffAccount(db, actorUserAccountId))) throw new ForbiddenError('forbidden', 'Only staff can list requests.');
  const conditions: SQL[] = [];
  if (filter.countyId) conditions.push(eq(caseTable.countyId, filter.countyId));
  if (filter.caseId) conditions.push(eq(preauthorizationRequest.caseId, filter.caseId));
  if (filter.from) conditions.push(sql`${preauthorizationRequest.receivedAt} >= ${filter.from}::date`);
  if (filter.to) conditions.push(sql`${preauthorizationRequest.receivedAt} < (${filter.to}::date + 1)`);
  const anyStatus = conditions.length ? and(...conditions) : undefined;
  const status = filter.status ? inArray(preauthorizationRequestStatuses.code, REQUEST_STATUS_GROUPS[filter.status] ?? [filter.status]) : undefined;
  if (batch.after) return requestBatch(db, and(anyStatus, status), batch);
  const [page, counts] = await Promise.all([requestBatch(db, and(anyStatus, status), batch), countByStatus(db, anyStatus)]);
  return { ...page, summary: { counts } };
}

// Requests this account sent.
export async function listOwnPreauthorizationRequests(db: DatabaseOrTransaction, actor: PortalActor, caseId: string | undefined, batch: BatchRequest) {
  return requestBatch(
    db,
    and(eq(preauthorizationRequest.requestedByUserAccountId, actor.userAccountId), ...(caseId ? [eq(preauthorizationRequest.caseId, caseId)] : [])),
    batch,
  );
}

export async function loadRequestRow(db: DatabaseOrTransaction, requestId: string): Promise<RequestRow> {
  if (!z.uuid().safeParse(requestId).success) throw new NotFoundError('Request not found.');
  const [row] = await fetchRequests(db, eq(preauthorizationRequest.preauthorizationRequestId, requestId));
  if (!row) throw new NotFoundError('Request not found.');
  return withoutCursor(row);
}

// Staff, or the account that sent it.
export async function requireReader(db: DatabaseOrTransaction, actorUserAccountId: string, row: RequestRow): Promise<boolean> {
  const staff = await isStaffAccount(db, actorUserAccountId);
  if (!staff && row.requestedByUserAccountId !== actorUserAccountId) throw new NotFoundError('Request not found.');
  return staff;
}

export async function getPreauthorizationRequest(db: DatabaseOrTransaction, actorUserAccountId: string, requestId: string) {
  const row = await loadRequestRow(db, requestId);
  const staff = await requireReader(db, actorUserAccountId, row);
  const [[view], questions, documents, providerDocuments] = await Promise.all([
    withCaseFacts(db, [row]),
    loadQuestions(db, requestId),
    listLinkedDocuments(db, { preauthorizationRequestId: requestId }),
    row.professionalId ? providerDocumentStatus(db, row.professionalId) : Promise.resolve(null),
  ]);
  return { request: view!, questions, documents, providerDocuments, canDecide: staff && OPEN_STATUSES.includes(row.statusCode) };
}

async function loadQuestions(db: DatabaseOrTransaction, requestId: string) {
  const asker = alias(userAccount, 'asker');
  const answerer = alias(userAccount, 'answerer');
  return db
    .select({
      preauthorizationQuestionId: preauthorizationQuestion.preauthorizationQuestionId,
      question: preauthorizationQuestion.question,
      askedByName: asker.displayName,
      askedAt: preauthorizationQuestion.askedAt,
      answer: preauthorizationQuestion.answer,
      answeredByName: answerer.displayName,
      answeredAt: preauthorizationQuestion.answeredAt,
    })
    .from(preauthorizationQuestion)
    .innerJoin(asker, eq(preauthorizationQuestion.askedByUserAccountId, asker.userAccountId))
    .leftJoin(answerer, eq(preauthorizationQuestion.answeredByUserAccountId, answerer.userAccountId))
    .where(eq(preauthorizationQuestion.preauthorizationRequestId, requestId))
    .orderBy(asc(preauthorizationQuestion.askedAt));
}
