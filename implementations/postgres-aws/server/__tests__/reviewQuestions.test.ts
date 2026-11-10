import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { finishReview } from '../src/billing/reviewRounds';
import { setSignOffApprovers } from '../src/billing/reviewAssignment';
import { answerQuestionAsStaff, answerQuestionAsSubmitter, askQuestion } from '../src/billing/reviewQuestions';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { invoiceExportContent } from '../src/billing/exportInvoice';
import { billingRecordCsv, loadBillingRecord } from '../src/billing/billingRecord';
import { ConflictError, ForbiddenError, ValidationError } from '../src/errors';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getReferenceId } from '../src/db/referenceLookups';
import {
  invoice,
  invoiceApprovalChain,
  invoiceEvent,
  invoiceEventTypes,
  invoiceLine,
  invoiceStatuses,
  userAccount,
} from '../src/db/schema';

let fixtures: BaselineFixtureIds;
let reviewer: string;
let approver: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  reviewer = await createStaff('reviewer', 'Reviewer One');
  approver = await createStaff('approver', 'Approver One');
});

afterAll(async () => {
  await testPool.end();
});

async function createAccount() {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  return { userAccountId: account!.userAccountId, professionalId };
}

async function createSubmittedInvoice(amounts: string[]) {
  const { caseId } = await createCase(
    testDb,
    { userAccountId: fixtures.staffUserAccountId },
    {
      requestId: randomUUID(),
      personId: fixtures.clientPersonId,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-15T12:00:00Z'),
    },
  );
  const submitter = await createAccount();
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: submitter.userAccountId,
      professionalId: submitter.professionalId,
      statusId: await getReferenceId(testDb, invoiceStatuses, 'submitted'),
      submittedAt: new Date(),
      submittedTotal: amounts.reduce((sum, amount) => sum + Number(amount), 0).toFixed(2),
      caseId,
    })
    .returning();
  await testDb.insert(invoiceApprovalChain).values({ invoiceId: row!.invoiceId, createdByUserAccountId: submitter.userAccountId, createdAt: new Date() });
  const lines = await testDb
    .insert(invoiceLine)
    .values(amounts.map((amount) => ({ invoiceId: row!.invoiceId, caseId, lineTypeId: fixtures.invoiceLineTypeSampleId, amount })))
    .returning();
  return { invoiceId: row!.invoiceId, lineIds: lines.map((line) => line.invoiceLineId), submitter };
}

async function statusCode(invoiceId: string) {
  const [row] = await testDb
    .select({ code: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  return row?.code;
}

async function eventCodes(invoiceId: string) {
  const rows = await testDb
    .select({ code: invoiceEventTypes.code })
    .from(invoiceEvent)
    .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
    .where(eq(invoiceEvent.invoiceId, invoiceId))
    .orderBy(asc(invoiceEvent.sequenceNumber));
  return rows.map((row) => row.code);
}

async function queueCounts(invoiceId: string) {
  const row = (await listReviewQueue(testDb, 'open')).invoices.find((invoice) => invoice.invoiceId === invoiceId);
  return { openQuestionCount: row?.openQuestionCount, answeredQuestionCount: row?.answeredQuestionCount };
}

describe('review questions', () => {
  it('holds review until the submitter answers, and keeps both on the record', async () => {
    const { invoiceId, lineIds, submitter } = await createSubmittedInvoice(['70.00', '50.00']);

    await askQuestion(testDb, reviewer, invoiceId, { question: 'Which hearing was this for?', invoiceLineId: lineIds[1] });
    expect(await statusCode(invoiceId)).toBe('awaiting_answer');

    // Lines may still be decided, but the round can't be finished.
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, { outcome: 'approved' });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await expect(finishReview(testDb, reviewer, invoiceId)).rejects.toThrow('waiting for an answer');

    const [question] = (await loadInvoiceDetail(testDb, invoiceId, 'submitter'))!.questions;
    expect(question).toMatchObject({ invoiceLineId: lineIds[1], answer: null, askedByDisplayName: null });

    await answerQuestionAsSubmitter(testDb, { userAccountId: submitter.userAccountId, professionalId: submitter.professionalId }, invoiceId, question!.invoiceReviewQuestionId, {
      answer: 'The status hearing on the 12th.',
    });
    expect(await statusCode(invoiceId)).toBe('under_review');
    const staffView = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.questions[0];
    expect(staffView).toMatchObject({ answer: 'The status hearing on the 12th.', askedByDisplayName: 'Reviewer One' });
    expect(staffView?.answeredAt).not.toBeNull();

    await finishReview(testDb, reviewer, invoiceId);
    expect(await statusCode(invoiceId)).toBe('awaiting_sign_off');
    expect(await eventCodes(invoiceId)).toEqual(['question_asked', 'question_answered', 'review_finished']);

    // Kept in the system, never exported.
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.questions).toHaveLength(1);
    const exported = [
      JSON.stringify(invoiceExportContent(detail, { includeReviewer: true, exportedAt: new Date() })),
      billingRecordCsv(await loadBillingRecord(testDb)),
    ].join('\n');
    expect(exported).not.toContain('Which hearing');
    expect(exported).not.toContain('status hearing on the 12th');
  });

  it('stays on hold until every question is answered', async () => {
    const { invoiceId, lineIds } = await createSubmittedInvoice(['70.00', '20.00']);

    const first = await askQuestion(testDb, reviewer, invoiceId, { question: 'What was the second trip?', invoiceLineId: lineIds[0] });
    const second = await askQuestion(testDb, reviewer, invoiceId, { question: 'Is the receipt missing?', invoiceLineId: lineIds[1] });

    await answerQuestionAsStaff(testDb, reviewer, invoiceId, first.invoiceReviewQuestionId, { answer: 'Return trip, by phone.' });
    expect(await statusCode(invoiceId)).toBe('awaiting_answer');
    expect(await queueCounts(invoiceId)).toEqual({ openQuestionCount: 1, answeredQuestionCount: 1 });
    await answerQuestionAsStaff(testDb, reviewer, invoiceId, second.invoiceReviewQuestionId, { answer: 'Sent by email.' });
    expect(await statusCode(invoiceId)).toBe('under_review');
    expect(await queueCounts(invoiceId)).toEqual({ openQuestionCount: 0, answeredQuestionCount: 2 });

    const questions = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.questions;
    expect(questions.map((question) => question.answeredByDisplayName)).toEqual(['Reviewer One', 'Reviewer One']);

    // Once the round is finished, the queue no longer calls out the answers.
    for (const invoiceLineId of lineIds) {
      await reviewInvoiceLine(testDb, reviewer, invoiceId, invoiceLineId, { outcome: 'approved' });
    }
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await finishReview(testDb, reviewer, invoiceId);
    expect(await queueCounts(invoiceId)).toEqual({ openQuestionCount: 0, answeredQuestionCount: 0 });
  });

  it('answers once, briefly, and only by the submitter, the professional or staff', async () => {
    const { invoiceId, lineIds } = await createSubmittedInvoice(['70.00']);
    const { invoiceReviewQuestionId } = await askQuestion(testDb, reviewer, invoiceId, { question: 'Which hearing?', invoiceLineId: lineIds[0] });

    const stranger = await createAccount();
    await expect(answerQuestionAsSubmitter(testDb, stranger, invoiceId, invoiceReviewQuestionId, { answer: 'Me' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(answerQuestionAsStaff(testDb, stranger.userAccountId, invoiceId, invoiceReviewQuestionId, { answer: 'Me' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      answerQuestionAsStaff(testDb, reviewer, invoiceId, invoiceReviewQuestionId, { answer: 'x'.repeat(501) }),
    ).rejects.toBeInstanceOf(ValidationError);

    await answerQuestionAsStaff(testDb, reviewer, invoiceId, invoiceReviewQuestionId, { answer: 'The first one.' });
    await expect(
      answerQuestionAsStaff(testDb, reviewer, invoiceId, invoiceReviewQuestionId, { answer: 'Changed my mind.' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('is asked by staff, about a line on the invoice, while it is in line review', async () => {
    const { invoiceId, lineIds } = await createSubmittedInvoice(['70.00']);
    const other = await createSubmittedInvoice(['10.00']);
    const otherReviewer = await createStaff('reviewer', 'Reviewer Two');
    const stranger = await createAccount();
    const invoiceLineId = lineIds[0]!;

    await expect(askQuestion(testDb, reviewer, invoiceId, { question: '', invoiceLineId })).rejects.toBeInstanceOf(ValidationError);
    await expect(askQuestion(testDb, reviewer, invoiceId, { question: 'About the invoice?' })).rejects.toBeInstanceOf(ValidationError);
    await expect(askQuestion(testDb, reviewer, invoiceId, { question: 'Hm?', invoiceLineId: other.lineIds[0] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await askQuestion(testDb, reviewer, invoiceId, { question: 'Which hearing?', invoiceLineId });
    // Another staff member may ask too; the invoice stays with its reviewer.
    await askQuestion(testDb, otherReviewer, invoiceId, { question: 'And this?', invoiceLineId });
    await expect(askQuestion(testDb, stranger.userAccountId, invoiceId, { question: 'And this?', invoiceLineId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
