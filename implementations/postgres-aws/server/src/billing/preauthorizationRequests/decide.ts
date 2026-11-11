import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { type Database, type DatabaseOrTransaction, type Transaction } from '../../db/client';
import { getReferenceId } from '../../db/referenceLookups';
import { caseTable, preauthorizationQuestion, preauthorizationRequest, preauthorizationRequestOutcomes, preauthorizationRequestStatuses, professional } from '../../db/schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { isStaffAccount } from '../../portal/portalActor';
import { recordCeilingInTx } from '../preauthorizations';
import { CLOSING_STATUS, DECISION_OUTCOMES, OPEN_STATUSES, money, parse } from './requestRules';
import { currentPreauthorizationId } from './submit';
import { getPreauthorizationRequest } from './read';

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
