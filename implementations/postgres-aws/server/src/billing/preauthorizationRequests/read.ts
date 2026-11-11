// Pre-authorization requests as staff and senders see them.
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type DatabaseOrTransaction } from '../../db/client';
import { caseTable, county, person, preauthorizationDecision, preauthorizationQuestion, preauthorizationRequest, preauthorizationRequestOutcomes, preauthorizationRequestStatuses, professional, professionalKinds, userAccount } from '../../db/schema';
import { ForbiddenError, NotFoundError } from '../../errors';
import { isStaffAccount, type PortalActor } from '../../portal/portalActor';
import { loadCaseNumbers } from '../invoiceDetail';
import { loadPreauthorizationSummaries } from '../preauthorizations';
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
  approvedAmount: preauthorizationDecision.approvedAmount,
  approvedHourlyRate: preauthorizationDecision.approvedHourlyRate,
  requestedByUserAccountId: preauthorizationRequest.requestedByUserAccountId,
  requestedByName: requester.displayName,
  requestedForName: requestedFor.displayName,
  receivedVia: preauthorizationRequest.receivedVia,
  receivedAt: preauthorizationRequest.receivedAt,
  decidedByName: decider.displayName,
  decidedAt: preauthorizationRequest.decidedAt,
  withdrawnAt: preauthorizationRequest.withdrawnAt,
};

function selectRequests(db: DatabaseOrTransaction) {
  return db
    .select(requestColumns)
    .from(preauthorizationRequest)
    .innerJoin(preauthorizationRequestStatuses, eq(preauthorizationRequest.statusId, preauthorizationRequestStatuses.id))
    .leftJoin(preauthorizationRequestOutcomes, eq(preauthorizationRequest.outcomeId, preauthorizationRequestOutcomes.id))
    .leftJoin(preauthorizationDecision, eq(preauthorizationRequest.preauthorizationDecisionId, preauthorizationDecision.preauthorizationDecisionId))
    .leftJoin(caseTable, eq(preauthorizationRequest.caseId, caseTable.caseId))
    .leftJoin(county, eq(caseTable.countyId, county.countyId))
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

type RequestRow = Awaited<ReturnType<typeof fetchRequests>>[number];

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
  const [numbers, summaries] = await Promise.all([
    loadCaseNumbers(db, caseIds),
    Promise.all(
      caseIds.map(async (caseId) => {
        const professionals = [...new Set(rows.filter((row) => row.caseId === caseId && row.professionalId).map((row) => row.professionalId!))];
        return [caseId, await loadPreauthorizationSummaries(db, caseId, professionals)] as const;
      }),
    ).then((pairs) => new Map(pairs)),
  ]);
  return rows.map((row) => {
    const proposed = (row.proposedDetails ?? {}) as { case?: { caseNumber?: string }; provider?: { name?: string } };
    const limit = row.caseId && row.professionalId ? ((summaries.get(row.caseId) ?? []).find((s) => s.professionalId === row.professionalId) ?? null) : null;
    return {
      ...row,
      caseNumber: row.caseId ? (numbers.get(row.caseId)?.caseNumber ?? null) : null,
      proposedCaseNumber: proposed.case?.caseNumber ?? null,
      proposedProviderName: proposed.provider?.name ?? null,
      limit,
    };
  });
}

export type PreauthorizationRequestView = Awaited<ReturnType<typeof withCaseFacts>>[number];

export async function listPreauthorizationRequests(db: DatabaseOrTransaction, actorUserAccountId: string, filter: RequestListFilter = {}) {
  if (!(await isStaffAccount(db, actorUserAccountId))) throw new ForbiddenError('forbidden', 'Only staff can list requests.');
  const conditions: SQL[] = [];
  if (filter.status === 'open') conditions.push(inArray(preauthorizationRequestStatuses.code, OPEN_STATUSES));
  else if (filter.status) conditions.push(eq(preauthorizationRequestStatuses.code, filter.status));
  if (filter.countyId) conditions.push(eq(caseTable.countyId, filter.countyId));
  if (filter.caseId) conditions.push(eq(preauthorizationRequest.caseId, filter.caseId));
  if (filter.from) conditions.push(sql`${preauthorizationRequest.receivedAt} >= ${filter.from}::date`);
  if (filter.to) conditions.push(sql`${preauthorizationRequest.receivedAt} < (${filter.to}::date + 1)`);
  const rows = await fetchRequests(db, conditions.length ? and(...conditions) : undefined);
  return withCaseFacts(db, rows);
}

// Requests this account sent.
export async function listOwnPreauthorizationRequests(db: DatabaseOrTransaction, actor: PortalActor, caseId?: string) {
  const rows = await fetchRequests(
    db,
    and(eq(preauthorizationRequest.requestedByUserAccountId, actor.userAccountId), ...(caseId ? [eq(preauthorizationRequest.caseId, caseId)] : [])),
  );
  return withCaseFacts(db, rows);
}

export async function loadRequestRow(db: DatabaseOrTransaction, requestId: string): Promise<RequestRow> {
  if (!z.uuid().safeParse(requestId).success) throw new NotFoundError('Request not found.');
  const [row] = await fetchRequests(db, eq(preauthorizationRequest.preauthorizationRequestId, requestId));
  if (!row) throw new NotFoundError('Request not found.');
  return row;
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
