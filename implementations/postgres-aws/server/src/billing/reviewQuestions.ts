// The reviewer's brief questions to the submitter about a line, and their
// answers (model/rules.yaml ask_review_question). The invoice waits for an
// answer until every question is answered.
import { z } from 'zod';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { invoice, invoiceLine, invoiceReviewQuestion, userAccount } from '../db/schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { PortalActor } from '../portal/portalActor';
import { recordInvoiceEvent } from './invoiceEvents';
import {
  AWAITING_ANSWER_INVOICE_STATUS_CODE,
  LINE_REVIEW_STATUS_CODES,
  UNDER_REVIEW_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';
import { claimLineReview, lockInvoiceForReview } from './reviewAssignment';
import { requireReviewPermission } from './reviewAccess';
import { currentChainId, setStatus } from './reviewRounds';
import type { Audience } from './invoiceDetail';

export const MAX_QUESTION_LENGTH = 500;

const askInputSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  invoiceLineId: z.uuid(),
});

const answerInputSchema = z.object({
  answer: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
});

export interface ReviewQuestionView {
  invoiceReviewQuestionId: string;
  invoiceLineId: string;
  question: string;
  // Staff only: reviewer identities stay internal.
  askedByDisplayName: string | null;
  askedAt: Date;
  answer: string | null;
  answeredByDisplayName: string | null;
  answeredAt: Date | null;
}

export async function loadReviewQuestions(
  db: DatabaseOrTransaction,
  invoiceId: string,
  audience: Audience,
): Promise<ReviewQuestionView[]> {
  const rows = await db
    .select()
    .from(invoiceReviewQuestion)
    .where(eq(invoiceReviewQuestion.invoiceId, invoiceId))
    .orderBy(asc(invoiceReviewQuestion.askedAt));
  const ids = rows.flatMap((row) => [row.askedByUserAccountId, ...(row.answeredByUserAccountId ? [row.answeredByUserAccountId] : [])]);
  const names =
    audience === 'staff' && ids.length > 0
      ? new Map(
          (
            await db
              .select({ id: userAccount.userAccountId, name: userAccount.displayName })
              .from(userAccount)
              .where(inArray(userAccount.userAccountId, [...new Set(ids)]))
          ).map((row) => [row.id, row.name]),
        )
      : new Map<string, string>();
  return rows.map((row) => ({
    invoiceReviewQuestionId: row.invoiceReviewQuestionId,
    invoiceLineId: row.invoiceLineId,
    question: row.question,
    askedByDisplayName: names.get(row.askedByUserAccountId) ?? null,
    askedAt: row.askedAt,
    answer: row.answer,
    answeredByDisplayName: row.answeredByUserAccountId ? (names.get(row.answeredByUserAccountId) ?? null) : null,
    answeredAt: row.answeredAt,
  }));
}

export async function askQuestion(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = askInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ question: `Write a question of up to ${MAX_QUESTION_LENGTH} characters.` });
  }
  const input = parsed.data;
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
      throw new ConflictError('invalid_state', 'Questions can only be asked while the invoice is being reviewed.');
    }
    // Like deciding a line, asking takes an unassigned invoice.
    await claimLineReview(tx, invoiceId, actorUserAccountId);
    const chainId = await currentChainId(tx, invoiceId);
    if (!chainId) {
      throw new ConflictError('invalid_state', 'Decide a line before asking about this invoice.');
    }
    const [line] = await tx
      .select({ invoiceLineId: invoiceLine.invoiceLineId })
      .from(invoiceLine)
      .where(and(eq(invoiceLine.invoiceLineId, input.invoiceLineId), eq(invoiceLine.invoiceId, invoiceId)));
    if (!line) {
      throw new ValidationError({ invoiceLineId: 'Choose a line on this invoice.' });
    }
    const [row] = await tx
      .insert(invoiceReviewQuestion)
      .values({
        invoiceId,
        invoiceApprovalChainId: chainId,
        invoiceLineId: input.invoiceLineId,
        question: input.question,
        askedByUserAccountId: actorUserAccountId,
        askedAt: new Date(),
      })
      .returning({ invoiceReviewQuestionId: invoiceReviewQuestion.invoiceReviewQuestionId });
    await setStatus(tx, invoiceId, AWAITING_ANSWER_INVOICE_STATUS_CODE, { eventTypeCode: 'question_asked', actorUserAccountId, chainId });
    return { invoiceReviewQuestionId: row!.invoiceReviewQuestionId, statusCode: AWAITING_ANSWER_INVOICE_STATUS_CODE };
  });
}

export class ReviewQuestionNotFoundError extends NotFoundError {
  constructor() {
    super('Question not found on this invoice.');
  }
}

// Staff record an answer received another way; they must be able to review.
export async function answerQuestionAsStaff(db: Database, actorUserAccountId: string, invoiceId: string, questionId: string, rawInput: unknown) {
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return answerQuestion(db, actorUserAccountId, invoiceId, questionId, rawInput, async () => {});
}

// The submitter, or the professional the invoice bills for.
export function mayAnswerAsSubmitter(
  actor: PortalActor,
  row: { submittedByUserAccountId: string | null; professionalId: string | null },
): boolean {
  return row.submittedByUserAccountId === actor.userAccountId || (Boolean(actor.professionalId) && row.professionalId === actor.professionalId);
}

export async function answerQuestionAsSubmitter(db: Database, actor: PortalActor, invoiceId: string, questionId: string, rawInput: unknown) {
  return answerQuestion(db, actor.userAccountId, invoiceId, questionId, rawInput, async (tx) => {
    const [row] = await tx
      .select({ submittedByUserAccountId: invoice.submittedByUserAccountId, professionalId: invoice.professionalId })
      .from(invoice)
      .where(eq(invoice.invoiceId, invoiceId));
    if (!row || !mayAnswerAsSubmitter(actor, row)) {
      throw new ForbiddenError('not_submitter', 'Only whoever sent the invoice, or the professional it bills for, can answer.');
    }
  });
}

async function answerQuestion(
  db: Database,
  actorUserAccountId: string,
  invoiceId: string,
  questionId: string,
  rawInput: unknown,
  authorize: (tx: Transaction) => Promise<void>,
) {
  const parsed = answerInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ answer: `Write an answer of up to ${MAX_QUESTION_LENGTH} characters.` });
  }
  if (!z.uuid().safeParse(questionId).success) {
    throw new ReviewQuestionNotFoundError();
  }
  return db.transaction(async (tx) => {
    const locked = await lockInvoiceForReview(tx, invoiceId);
    await authorize(tx);
    const [question] = await tx
      .select()
      .from(invoiceReviewQuestion)
      .where(and(eq(invoiceReviewQuestion.invoiceReviewQuestionId, questionId), eq(invoiceReviewQuestion.invoiceId, invoiceId)));
    if (!question) {
      throw new ReviewQuestionNotFoundError();
    }
    if (question.answeredAt) {
      throw new ConflictError('already_answered', 'This question has already been answered.');
    }
    await tx
      .update(invoiceReviewQuestion)
      .set({ answer: parsed.data.answer, answeredByUserAccountId: actorUserAccountId, answeredAt: new Date() })
      .where(eq(invoiceReviewQuestion.invoiceReviewQuestionId, questionId));
    const [stillOpen] = await tx
      .select({ id: invoiceReviewQuestion.invoiceReviewQuestionId })
      .from(invoiceReviewQuestion)
      .where(and(eq(invoiceReviewQuestion.invoiceId, invoiceId), isNull(invoiceReviewQuestion.answeredAt)))
      .limit(1);
    const event = { eventTypeCode: 'question_answered', actorUserAccountId, chainId: question.invoiceApprovalChainId };
    if (locked.statusCode === AWAITING_ANSWER_INVOICE_STATUS_CODE && !stillOpen) {
      await setStatus(tx, invoiceId, UNDER_REVIEW_INVOICE_STATUS_CODE, event);
      return { statusCode: UNDER_REVIEW_INVOICE_STATUS_CODE };
    }
    await recordInvoiceEvent(tx, { invoiceId, statusId: locked.statusId, ...event });
    return { statusCode: locked.statusCode };
  });
}
