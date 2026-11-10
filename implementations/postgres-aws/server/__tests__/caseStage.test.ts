import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { caseStageExpression } from '../src/cases/caseStage';
import { caseTable, invoice, invoiceReviewAssignment, userAccount } from '../src/db/schema';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

function baseCaseInput(overrides: Partial<CreateCaseInput> = {}): CreateCaseInput {
  return {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

async function stageOf(caseId: string): Promise<string | null> {
  const [row] = await testDb
    .select({ stage: caseStageExpression })
    .from(caseTable)
    .where(eq(caseTable.caseId, caseId));
  return row?.stage ?? null;
}

describe('caseStageExpression', () => {
  it('buckets an open case with no invoice waiting as represented', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    expect(await stageOf(caseId)).toBe('represented');
  });

  it('buckets a case whose waiting invoice has no reviewer as needs-assignment', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await sentInvoice(caseId, fixtures.invoiceStatusSubmittedId);
    expect(await stageOf(caseId)).toBe('needs-assignment');
  });

  it('moves it to billing once a reviewer is assigned, and back if the assignment ends', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const invoiceId = await sentInvoice(caseId, fixtures.invoiceStatusSubmittedId);
    const [assignment] = await testDb
      .insert(invoiceReviewAssignment)
      .values({
        invoiceId,
        stepTypeId: fixtures.invoiceApprovalStepTypeLineReviewId,
        position: 1,
        assignedUserAccountId: fixtures.staffUserAccountId,
        assignedAt: new Date(),
      })
      .returning();
    expect(await stageOf(caseId)).toBe('billing');

    await testDb
      .update(invoiceReviewAssignment)
      .set({ endedAt: new Date() })
      .where(eq(invoiceReviewAssignment.invoiceReviewAssignmentId, assignment!.invoiceReviewAssignmentId));
    expect(await stageOf(caseId)).toBe('needs-assignment');
  });

  it('ignores a draft invoice (not yet submitted)', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await sentInvoice(caseId, fixtures.invoiceStatusDraftId);
    expect(await stageOf(caseId)).toBe('represented');
  });

  it('buckets a case whose only reviewed invoice was approved as closing', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await sentInvoice(caseId, fixtures.invoiceStatusApprovedId);
    expect(await stageOf(caseId)).toBe('closing');
  });

  it('keeps a case waiting while a later invoice awaits review, even after one was approved', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await sentInvoice(caseId, fixtures.invoiceStatusApprovedId);
    await sentInvoice(caseId, fixtures.invoiceStatusSubmittedId);
    expect(await stageOf(caseId)).toBe('needs-assignment');
  });

  it('has no stage once the case is closed', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await testDb.update(caseTable).set({ closedOn: '2026-02-01' }).where(eq(caseTable.caseId, caseId));
    expect(await stageOf(caseId)).toBeNull();
  });

  async function sentInvoice(caseId: string, statusId: string): Promise<string> {
    const [row] = await testDb
      .insert(invoice)
      .values({
        submittedByUserAccountId: fixtures.staffUserAccountId,
        professionalId: await createProfessional(),
        statusId,
        submittedAt: new Date(),
        submittedTotal: '100.00',
        caseId,
      })
      .returning();
    return row!.invoiceId;
  }

  async function createProfessional(): Promise<string> {
    const email = `vendor-${randomUUID()}@example.com`;
    const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
    if (!account) {
      throw new Error('Expected insert to return a row.');
    }
    return ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
  }
});
