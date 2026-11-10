// model/rules.yaml request_preauthorization and workflows.yaml preauthorization_request.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import {
  caseAssignment,
  caseTable,
  county,
  document,
  documentLink,
  documentPurposes,
  person,
  preauthorizationDecision,
  preauthorizationQuestion,
  preauthorizationRequest,
  preauthorizationRequestOutcomes,
  preauthorizationRequestStatuses,
  professional,
  professionalKinds,
  providerServiceRate,
  userAccount,
} from '../db/schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { isStaffAccount, billableProfessionalIds, type PortalActor } from '../portal/portalActor';
import type { DocumentStore } from '../imports/documentStore';
import { loadCaseNumbers } from './invoiceDetail';
import { loadPreauthorizationSummaries, recordCeilingInTx, summaryForProfessional, type PreauthorizationSummary } from './preauthorizations';
import { thresholdBoundProfessionalIds, thresholdFor } from './preauthorizationThresholds';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';
import { fromCents, toCents } from './money';

const OPEN_STATUSES = ['submitted', 'info_requested'];
const RATE_BASES = ['hourly', 'flat', 'per_unit'] as const;
const DECISION_OUTCOMES = ['approved', 'denied', 'not_needed', 'duplicate', 'moot'] as const;
// The status each outcome leaves.
const CLOSING_STATUS: Record<(typeof DECISION_OUTCOMES)[number], string> = {
  approved: 'approved',
  denied: 'denied',
  not_needed: 'not_needed',
  duplicate: 'not_needed',
  moot: 'not_needed',
};

const money = z.coerce.number().positive('Enter an amount above zero.').max(10_000_000);

const requestInputSchema = z
  .object({
    caseId: z.uuid().nullable().optional(),
    proposedCase: z
      .object({
        caseNumber: z.string().trim().min(1, 'Enter the case number.').max(100),
        countyId: z.uuid().nullable().optional(),
        countyName: z.string().trim().max(100).optional(),
      })
      .optional(),
    professionalId: z.uuid().nullable().optional(),
    proposedProvider: z
      .object({
        name: z.string().trim().min(1, 'Enter the provider’s name.').max(200),
        email: z.string().trim().max(200).optional(),
      })
      .optional(),
    professionalKindId: z.uuid().nullable().optional(),
    serviceDescription: z.string().trim().min(1, 'Say what the work is.').max(500),
    rateBasis: z.enum(RATE_BASES, 'Choose hourly, flat or per unit.'),
    requestedRate: money.nullable().optional(),
    estimatedQuantity: z.coerce.number().positive('Enter hours or units above zero.').max(100_000).nullable().optional(),
    requestedAmount: money,
    justification: z.string().trim().min(1, 'Say why the work is needed.').max(4000),
    // Staff recording a request received another way.
    receivedVia: z.string().trim().max(100).optional(),
    receivedOn: z.iso.date().optional(),
    requestedForPersonId: z.uuid().nullable().optional(),
  })
  .refine((input) => input.caseId || input.proposedCase, { path: ['caseId'], message: 'Choose the case, or enter its number.' })
  .refine((input) => input.professionalId || input.proposedProvider, { path: ['professionalId'], message: 'Choose the provider, or enter their name.' })
  .refine((input) => input.rateBasis === 'flat' || input.requestedRate, { path: ['requestedRate'], message: 'Enter the rate.' });

function parse<T extends z.ZodType>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  return parsed.data;
}

// YY-NNN by the year received, one sequence across requests.
async function nextRequestNumber(tx: Transaction, receivedAt: Date): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('preauthorization_request_number'))`);
  const prefix = `${calendarDateInReportingTimeZone(receivedAt).slice(2, 4)}-`;
  const rows = await tx
    .select({ number: preauthorizationRequest.requestNumber })
    .from(preauthorizationRequest)
    .where(like(preauthorizationRequest.requestNumber, `${prefix}%`));
  const highest = rows.reduce((max, row) => Math.max(max, Number(row.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

async function requireRequesterOnCase(db: DatabaseOrTransaction, actor: PortalActor, caseId: string): Promise<void> {
  if ((await billableProfessionalIds(db, actor, caseId)).length === 0) {
    throw new ForbiddenError('forbidden', 'You can ask only on cases you work on.');
  }
}

// Providers a submitter may name: anyone on their cases, and whoever they bill for.
export async function listRequestableProviders(db: DatabaseOrTransaction, actor: PortalActor) {
  const own = await billableProfessionalIds(db, actor, null);
  if (own.length === 0) return [];
  const cases = await db
    .selectDistinct({ caseId: caseAssignment.caseId })
    .from(caseAssignment)
    .where(and(inArray(caseAssignment.professionalId, own), isNull(caseAssignment.endedAt)));
  const caseIds = cases.map((row) => row.caseId);
  const onCases =
    caseIds.length === 0
      ? []
      : await db
          .selectDistinct({ professionalId: caseAssignment.professionalId })
          .from(caseAssignment)
          .where(and(inArray(caseAssignment.caseId, caseIds), isNull(caseAssignment.endedAt)));
  const ids = [...new Set([...own, ...onCases.map((row) => row.professionalId)])];
  const rows = await db
    .select({
      professionalId: professional.professionalId,
      displayName: professional.displayName,
      professionalKindId: professional.professionalKindId,
      kindName: professionalKinds.displayName,
    })
    .from(professional)
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(and(inArray(professional.professionalId, ids), eq(professional.active, true)))
    .orderBy(asc(professional.displayName));
  return rows;
}

export async function createPreauthorizationRequest(db: Database, actor: PortalActor, rawInput: unknown) {
  const input = parse(requestInputSchema, rawInput);
  const staff = await isStaffAccount(db, actor.userAccountId);
  const caseId = input.caseId ?? null;
  const professionalId = input.professionalId ?? null;
  if (!staff) {
    if (caseId) await requireRequesterOnCase(db, actor, caseId);
    if (professionalId && !(await listRequestableProviders(db, actor)).some((row) => row.professionalId === professionalId)) {
      throw new ValidationError({ professionalId: 'Choose a provider from the list, or enter their name.' });
    }
  }
  if (caseId) {
    const [row] = await db.select({ id: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, caseId));
    if (!row) throw new NotFoundError('Case not found.');
  }
  const receivedAt = staff && input.receivedOn ? new Date(`${input.receivedOn}T12:00:00Z`) : new Date();
  return db.transaction(async (tx) => {
    const preauthorizationId = caseId ? await currentPreauthorizationId(tx, caseId, professionalId) : null;
    const created = firstRow(
      await tx
        .insert(preauthorizationRequest)
        .values({
          requestNumber: await nextRequestNumber(tx, receivedAt),
          caseId,
          professionalId,
          proposedDetails:
            input.proposedCase || input.proposedProvider
              ? { case: caseId ? undefined : input.proposedCase, provider: professionalId ? undefined : input.proposedProvider }
              : null,
          preauthorizationId,
          professionalKindId: input.professionalKindId ?? null,
          serviceDescription: input.serviceDescription,
          rateBasis: input.rateBasis,
          requestedRate: input.rateBasis === 'flat' ? null : (input.requestedRate?.toFixed(2) ?? null),
          estimatedQuantity: input.rateBasis === 'flat' ? null : (input.estimatedQuantity?.toString() ?? null),
          requestedAmount: input.requestedAmount.toFixed(2),
          justification: input.justification,
          statusId: await getReferenceId(tx, preauthorizationRequestStatuses, 'submitted'),
          requestedByUserAccountId: actor.userAccountId,
          requestedForPersonId: staff ? (input.requestedForPersonId ?? null) : null,
          receivedVia: staff ? input.receivedVia || null : null,
          receivedAt,
        })
        .returning({ id: preauthorizationRequest.preauthorizationRequestId, requestNumber: preauthorizationRequest.requestNumber }),
    );
    return { preauthorizationRequestId: created.id, requestNumber: created.requestNumber };
  });
}

async function currentPreauthorizationId(db: DatabaseOrTransaction, caseId: string, professionalId: string | null): Promise<string | null> {
  if (!professionalId) return null;
  const summary = (await loadPreauthorizationSummaries(db, caseId)).find(
    (row) => row.professionalId === professionalId && row.source === 'preauthorized',
  );
  return summary?.preauthorizationId ?? null;
}

// Shown before sending.
export async function previewRequest(db: DatabaseOrTransaction, actor: PortalActor, rawInput: unknown) {
  const input = parse(
    z.object({ caseId: z.uuid().nullable().optional(), professionalId: z.uuid().nullable().optional(), countyId: z.uuid().nullable().optional(), requestedAmount: z.coerce.number().nonnegative().optional() }),
    rawInput,
  );
  const staff = await isStaffAccount(db, actor.userAccountId);
  if (!staff) {
    if (input.caseId) await requireRequesterOnCase(db, actor, input.caseId);
    if (input.professionalId && !(await mayFileForProvider(db, actor, input.professionalId))) {
      throw new NotFoundError('Provider not found.');
    }
  }
  let limit: PreauthorizationSummary | null = null;
  let countyId = input.countyId ?? null;
  if (input.caseId) {
    const [row] = await db.select({ countyId: caseTable.countyId }).from(caseTable).where(eq(caseTable.caseId, input.caseId));
    countyId = row?.countyId ?? null;
    if (input.professionalId) {
      limit = summaryForProfessional(await loadPreauthorizationSummaries(db, input.caseId, [input.professionalId]), input.professionalId);
    }
  }
  const threshold = await thresholdFor(db, countyId);
  const bound = input.professionalId ? (await thresholdBoundProfessionalIds(db, [input.professionalId])).has(input.professionalId) : true;
  const documents = input.professionalId ? await providerDocumentStatus(db, input.professionalId) : null;
  const billed = limit ? toCents(limit.approvedSoFar) + toCents(limit.waiting) : 0;
  // A total below what's billed is a mistake, not "not needed".
  const coversBilled = input.requestedAmount !== undefined && toCents(input.requestedAmount) >= billed;
  return {
    threshold: bound ? threshold : null,
    limit,
    billed: fromCents(billed),
    withinThreshold:
      bound &&
      threshold !== null &&
      coversBilled &&
      (!limit || limit.source === 'threshold') &&
      toCents(input.requestedAmount!) <= toCents(threshold),
    documents,
  };
}

// --- reading ---------------------------------------------------------------

const requester = alias(userAccount, 'requester');
const decider = alias(userAccount, 'decider');
const requestedFor = alias(person, 'requested_for');
const provider = alias(professional, 'provider');

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

async function loadRequestRow(db: DatabaseOrTransaction, requestId: string): Promise<RequestRow> {
  if (!z.uuid().safeParse(requestId).success) throw new NotFoundError('Request not found.');
  const [row] = await fetchRequests(db, eq(preauthorizationRequest.preauthorizationRequestId, requestId));
  if (!row) throw new NotFoundError('Request not found.');
  return row;
}

// Staff, or the account that sent it.
async function requireReader(db: DatabaseOrTransaction, actorUserAccountId: string, row: RequestRow): Promise<boolean> {
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

// --- changes ---------------------------------------------------------------

async function lockOpenRequest(tx: Transaction, requestId: string) {
  if (!z.uuid().safeParse(requestId).success) throw new NotFoundError('Request not found.');
  const [locked] = await tx
    .select({
      statusCode: preauthorizationRequestStatuses.code,
      requestedByUserAccountId: preauthorizationRequest.requestedByUserAccountId,
      caseId: preauthorizationRequest.caseId,
      professionalId: preauthorizationRequest.professionalId,
      requestNumber: preauthorizationRequest.requestNumber,
      receivedAt: preauthorizationRequest.receivedAt,
      requestedRate: preauthorizationRequest.requestedRate,
      rateBasis: preauthorizationRequest.rateBasis,
    })
    .from(preauthorizationRequest)
    .innerJoin(preauthorizationRequestStatuses, eq(preauthorizationRequest.statusId, preauthorizationRequestStatuses.id))
    .where(eq(preauthorizationRequest.preauthorizationRequestId, requestId))
    .for('update', { of: preauthorizationRequest });
  if (!locked) throw new NotFoundError('Request not found.');
  if (!OPEN_STATUSES.includes(locked.statusCode)) throw new ConflictError('request_closed', 'This request is already decided or withdrawn.');
  return locked;
}

async function setStatus(tx: Transaction, requestId: string, code: string, values: Partial<typeof preauthorizationRequest.$inferInsert> = {}) {
  await tx
    .update(preauthorizationRequest)
    .set({ statusId: await getReferenceId(tx, preauthorizationRequestStatuses, code), ...values })
    .where(eq(preauthorizationRequest.preauthorizationRequestId, requestId));
}

async function requireStaff(db: DatabaseOrTransaction, actorUserAccountId: string, message: string) {
  if (!(await isStaffAccount(db, actorUserAccountId))) throw new ForbiddenError('forbidden', message);
}

export async function askRequestQuestion(db: Database, actorUserAccountId: string, requestId: string, rawInput: unknown) {
  await requireStaff(db, actorUserAccountId, 'Only staff can ask for more information.');
  const input = parse(z.object({ question: z.string().trim().min(1, 'Enter your question.').max(2000) }), rawInput);
  await db.transaction(async (tx) => {
    await lockOpenRequest(tx, requestId);
    await tx.insert(preauthorizationQuestion).values({
      preauthorizationRequestId: requestId,
      question: input.question,
      askedByUserAccountId: actorUserAccountId,
      askedAt: new Date(),
    });
    await setStatus(tx, requestId, 'info_requested');
  });
  return getPreauthorizationRequest(db, actorUserAccountId, requestId);
}

// The requester, or staff recording an answer received another way.
export async function answerRequestQuestion(db: Database, actorUserAccountId: string, requestId: string, questionId: string, rawInput: unknown) {
  const input = parse(z.object({ answer: z.string().trim().min(1, 'Enter your answer.').max(4000) }), rawInput);
  await db.transaction(async (tx) => {
    const locked = await lockOpenRequest(tx, requestId);
    if (locked.requestedByUserAccountId !== actorUserAccountId && !(await isStaffAccount(tx, actorUserAccountId))) {
      throw new NotFoundError('Request not found.');
    }
    if (!z.uuid().safeParse(questionId).success) throw new NotFoundError('Question not found.');
    const answered = await tx
      .update(preauthorizationQuestion)
      .set({ answer: input.answer, answeredByUserAccountId: actorUserAccountId, answeredAt: new Date() })
      .where(
        and(
          eq(preauthorizationQuestion.preauthorizationQuestionId, questionId),
          eq(preauthorizationQuestion.preauthorizationRequestId, requestId),
          isNull(preauthorizationQuestion.answeredAt),
        ),
      )
      .returning({ id: preauthorizationQuestion.preauthorizationQuestionId });
    if (answered.length === 0) throw new ValidationError({ answer: 'This question is already answered.' });
    const [open] = await tx
      .select({ id: preauthorizationQuestion.preauthorizationQuestionId })
      .from(preauthorizationQuestion)
      .where(and(eq(preauthorizationQuestion.preauthorizationRequestId, requestId), isNull(preauthorizationQuestion.answeredAt)));
    if (!open) await setStatus(tx, requestId, 'submitted');
  });
  return getPreauthorizationRequest(db, actorUserAccountId, requestId);
}

export async function matchPreauthorizationRequest(db: Database, actorUserAccountId: string, requestId: string, rawInput: unknown) {
  await requireStaff(db, actorUserAccountId, 'Only staff can match a request.');
  const input = parse(z.object({ caseId: z.uuid().optional(), professionalId: z.uuid().optional() }), rawInput);
  await db.transaction(async (tx) => {
    const locked = await lockOpenRequest(tx, requestId);
    const caseId = input.caseId ?? locked.caseId;
    const professionalId = input.professionalId ?? locked.professionalId;
    if (input.caseId) {
      const [row] = await tx.select({ id: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, input.caseId));
      if (!row) throw new NotFoundError('Case not found.');
    }
    if (input.professionalId) {
      const [row] = await tx.select({ id: professional.professionalId }).from(professional).where(eq(professional.professionalId, input.professionalId));
      if (!row) throw new NotFoundError('Provider not found.');
    }
    await tx
      .update(preauthorizationRequest)
      .set({
        caseId,
        professionalId,
        preauthorizationId: caseId ? await currentPreauthorizationId(tx, caseId, professionalId) : null,
      })
      .where(eq(preauthorizationRequest.preauthorizationRequestId, requestId));
  });
  return getPreauthorizationRequest(db, actorUserAccountId, requestId);
}

const decisionSchema = z
  .object({
    outcome: z.enum(DECISION_OUTCOMES, 'Choose a decision.'),
    approvedAmount: money.optional(),
    approvedHourlyRate: money.nullable().optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .refine((input) => input.outcome !== 'approved' || input.approvedAmount, { path: ['approvedAmount'], message: 'Enter the total approved.' })
  .refine((input) => input.outcome === 'approved' || input.reason, { path: ['reason'], message: 'Give the reason the requester will see.' });

export async function decidePreauthorizationRequest(db: Database, actorUserAccountId: string, requestId: string, rawInput: unknown) {
  await requireStaff(db, actorUserAccountId, 'Only staff can decide a request.');
  const input = parse(decisionSchema, rawInput);
  await db.transaction(async (tx) => {
    const locked = await lockOpenRequest(tx, requestId);
    const now = new Date();
    const decided = {
      outcomeId: await getReferenceId(tx, preauthorizationRequestOutcomes, input.outcome),
      decisionReason: input.reason || null,
      decidedByUserAccountId: actorUserAccountId,
      decidedAt: now,
    };
    if (input.outcome !== 'approved') {
      await setStatus(tx, requestId, CLOSING_STATUS[input.outcome], decided);
      return;
    }
    if (locked.statusCode !== 'submitted') {
      throw new ValidationError({ outcome: 'Record the answer to every question before approving.' });
    }
    if (!locked.caseId || !locked.professionalId) {
      throw new ValidationError({ outcome: 'Match the case and provider before approving.' });
    }
    const hourlyRate =
      input.approvedHourlyRate !== undefined
        ? (input.approvedHourlyRate?.toFixed(2) ?? null)
        : locked.rateBasis === 'hourly'
          ? locked.requestedRate
          : undefined;
    const { preauthorizationId, decisionId } = await recordCeilingInTx(tx, actorUserAccountId, {
      caseId: locked.caseId,
      professionalId: locked.professionalId,
      amount: input.approvedAmount!.toFixed(2),
      hourlyRate,
      authorizationNumber: locked.requestNumber,
      requestedAt: locked.receivedAt,
      reason: input.reason || null,
    });
    await setStatus(tx, requestId, 'approved', { ...decided, preauthorizationId, preauthorizationDecisionId: decisionId });
  });
  return getPreauthorizationRequest(db, actorUserAccountId, requestId);
}

export async function withdrawPreauthorizationRequest(db: Database, actorUserAccountId: string, requestId: string) {
  await db.transaction(async (tx) => {
    const locked = await lockOpenRequest(tx, requestId);
    if (locked.requestedByUserAccountId !== actorUserAccountId && !(await isStaffAccount(tx, actorUserAccountId))) {
      throw new NotFoundError('Request not found.');
    }
    await setStatus(tx, requestId, 'withdrawn', { withdrawnByUserAccountId: actorUserAccountId, withdrawnAt: new Date() });
  });
  return getPreauthorizationRequest(db, actorUserAccountId, requestId);
}

// --- documents ---------------------------------------------------------------

const DOCUMENT_PURPOSES = ['cv', 'fee_schedule', 'quote', 'supporting'] as const;
type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// PDFs, Word documents and images; never rendered in the app's origin.
function detectDocument(bytes: Buffer): string {
  if (bytes.length === 0) throw new ValidationError({ file: 'The file is empty.' });
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new ValidationError({ file: 'Files must be 10 MB or smaller.' });
  const head = bytes.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x50 && head[1] === 0x4b && bytes.includes('word/document.xml')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  throw new ValidationError({ file: 'Upload a PDF, a Word document (.docx), or a PNG or JPEG image.' });
}

type LinkTarget = { preauthorizationRequestId: string } | { professionalId: string };

export async function listLinkedDocuments(db: DatabaseOrTransaction, target: LinkTarget) {
  const condition =
    'preauthorizationRequestId' in target
      ? eq(documentLink.preauthorizationRequestId, target.preauthorizationRequestId)
      : eq(documentLink.professionalId, target.professionalId);
  return db
    .select({
      documentId: document.documentId,
      displayName: document.displayName,
      purposeCode: documentPurposes.code,
      purposeName: documentPurposes.displayName,
      recordedAt: document.recordedAt,
    })
    .from(documentLink)
    .innerJoin(document, eq(documentLink.documentId, document.documentId))
    .innerJoin(documentPurposes, eq(documentLink.purposeId, documentPurposes.id))
    .where(and(condition, isNull(document.contentDeletedAt)))
    .orderBy(desc(document.recordedAt));
}

// model/rules.yaml request_provider_documents.
export async function providerDocumentStatus(db: DatabaseOrTransaction, professionalId: string) {
  const [documents, rates] = await Promise.all([
    listLinkedDocuments(db, { professionalId }),
    db
      .select({
        providerServiceRateId: providerServiceRate.providerServiceRateId,
        serviceDescription: providerServiceRate.serviceDescription,
        rate: providerServiceRate.rate,
        rateBasis: providerServiceRate.rateBasis,
        effectiveFrom: providerServiceRate.effectiveFrom,
      })
      .from(providerServiceRate)
      .where(eq(providerServiceRate.professionalId, professionalId))
      .orderBy(asc(providerServiceRate.serviceDescription), desc(providerServiceRate.effectiveFrom)),
  ]);
  const hasCv = documents.some((row) => row.purposeCode === 'cv');
  const hasFees = documents.some((row) => row.purposeCode === 'fee_schedule' || row.purposeCode === 'quote');
  return { documents, rates, missing: [...(hasCv ? [] : ['cv']), ...(hasFees ? [] : ['fee_schedule'])] };
}

// Staff, or a submitter who may name the provider.
async function mayFileForProvider(db: DatabaseOrTransaction, actor: PortalActor, professionalId: string): Promise<boolean> {
  if (await isStaffAccount(db, actor.userAccountId)) return true;
  return (await listRequestableProviders(db, actor)).some((row) => row.professionalId === professionalId);
}

export async function addDocument(
  db: Database,
  store: DocumentStore,
  actor: PortalActor,
  target: LinkTarget,
  file: { bytes: Buffer; fileName: string | undefined; purpose: string | undefined },
) {
  const purpose = parse(z.enum(DOCUMENT_PURPOSES, 'Say what the file is.'), file.purpose) as DocumentPurpose;
  if ('preauthorizationRequestId' in target) {
    const row = await loadRequestRow(db, target.preauthorizationRequestId);
    await requireReader(db, actor.userAccountId, row);
    if (!OPEN_STATUSES.includes(row.statusCode)) {
      throw new ConflictError('request_closed', 'This request is already decided or withdrawn.');
    }
  } else if (!(await mayFileForProvider(db, actor, target.professionalId))) {
    throw new NotFoundError('Provider not found.');
  }
  const mediaType = detectDocument(file.bytes);
  const storageReference = await store.put(file.bytes);
  try {
    await db.transaction(async (tx) => {
      const created = firstRow(
        await tx
          .insert(document)
          .values({
            storageReference,
            displayName: (file.fileName ?? 'document').replace(/[\\/\r\n]/g, ' ').slice(0, 200),
            mediaType,
            contentHash: createHash('sha256').update(file.bytes).digest('hex'),
            recordedAt: new Date(),
            recordedByUserAccountId: actor.userAccountId,
          })
          .returning({ documentId: document.documentId }),
      );
      await tx.insert(documentLink).values({
        documentId: created.documentId,
        preauthorizationRequestId: 'preauthorizationRequestId' in target ? target.preauthorizationRequestId : null,
        professionalId: 'professionalId' in target ? target.professionalId : null,
        purposeId: await getReferenceId(tx, documentPurposes, purpose),
      });
    });
  } catch (error) {
    await store.delete(storageReference);
    throw error;
  }
  return 'preauthorizationRequestId' in target ? listLinkedDocuments(db, target) : providerDocumentStatus(db, target.professionalId);
}

export async function readLinkedDocument(db: DatabaseOrTransaction, store: DocumentStore, actor: PortalActor, documentId: string) {
  if (!z.uuid().safeParse(documentId).success) throw new NotFoundError('File not found.');
  const [row] = await db
    .select({
      storageReference: document.storageReference,
      displayName: document.displayName,
      mediaType: document.mediaType,
      preauthorizationRequestId: documentLink.preauthorizationRequestId,
      professionalId: documentLink.professionalId,
    })
    .from(documentLink)
    .innerJoin(document, eq(documentLink.documentId, document.documentId))
    .where(and(eq(document.documentId, documentId), isNull(document.contentDeletedAt), or(sql`${documentLink.preauthorizationRequestId} is not null`, sql`${documentLink.professionalId} is not null`)));
  if (!row) throw new NotFoundError('File not found.');
  if (row.preauthorizationRequestId) {
    await requireReader(db, actor.userAccountId, await loadRequestRow(db, row.preauthorizationRequestId));
  } else if (!(await mayFileForProvider(db, actor, row.professionalId!))) {
    throw new NotFoundError('File not found.');
  }
  const bytes = await store.get(row.storageReference);
  if (!bytes) throw new NotFoundError('File not found.');
  return { fileName: row.displayName, mediaType: row.mediaType, bytes };
}

const serviceRateSchema = z.object({
  serviceDescription: z.string().trim().min(1, 'Name the service.').max(200),
  rate: money,
  rateBasis: z.enum(RATE_BASES, 'Choose hourly, flat or per unit.'),
  effectiveFrom: z.iso.date('Enter the date it applies from.'),
});

export async function addProviderServiceRate(db: Database, actor: PortalActor, professionalId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(professionalId).success || !(await mayFileForProvider(db, actor, professionalId))) {
    throw new NotFoundError('Provider not found.');
  }
  const input = parse(serviceRateSchema, rawInput);
  await db.insert(providerServiceRate).values({
    professionalId,
    serviceDescription: input.serviceDescription,
    rate: input.rate.toFixed(2),
    rateBasis: input.rateBasis,
    effectiveFrom: input.effectiveFrom,
    recordedByUserAccountId: actor.userAccountId,
    recordedAt: new Date(),
  });
  return providerDocumentStatus(db, professionalId);
}
