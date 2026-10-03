import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { caseStageExpression } from '../src/cases/caseStage';
import { caseAssignment, caseTable, invoice, userAccount } from '../src/db/schema';
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
  it('buckets a freshly opened case as awaiting-assignment', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    expect(await stageOf(caseId)).toBe('awaiting-assignment');
  });

  it('buckets an open-assignment case as represented', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId: await createProfessional(),
      assignedAt: new Date(),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    expect(await stageOf(caseId)).toBe('represented');
  });

  it('ignores an ended assignment and falls back to awaiting-assignment', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId: await createProfessional(),
      assignedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: new Date('2026-01-10T00:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    expect(await stageOf(caseId)).toBe('awaiting-assignment');
  });

  it('buckets a case with a submitted invoice as billing, even if also assigned', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const professionalId = await createProfessional();
    await testDb.insert(caseAssignment).values({
      caseId,
      professionalId,
      assignedAt: new Date(),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    await testDb.insert(invoice).values({
      submittedByUserAccountId: fixtures.staffUserAccountId,
      professionalId,
      statusId: fixtures.invoiceStatusSubmittedId,
      submittedAt: new Date(),
      submittedTotal: '100.00',
      caseId,
    });
    expect(await stageOf(caseId)).toBe('billing');
  });

  it('ignores a draft invoice (not yet submitted)', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await testDb.insert(invoice).values({
      submittedByUserAccountId: fixtures.staffUserAccountId,
      professionalId: await createProfessional(),
      statusId: fixtures.invoiceStatusDraftId,
      submittedTotal: '0.00',
      caseId,
    });
    expect(await stageOf(caseId)).toBe('awaiting-assignment');
  });

  it('buckets a case whose only reviewed invoice was approved as closing', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await testDb.insert(invoice).values({
      submittedByUserAccountId: fixtures.staffUserAccountId,
      professionalId: await createProfessional(),
      statusId: fixtures.invoiceStatusApprovedId,
      submittedAt: new Date(),
      submittedTotal: '75.00',
      caseId,
    });
    expect(await stageOf(caseId)).toBe('closing');
  });

  it('keeps a case in billing while a later invoice awaits review, even after one was approved', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const professionalId = await createProfessional();
    await testDb.insert(invoice).values([
      {
        submittedByUserAccountId: fixtures.staffUserAccountId,
        professionalId,
        statusId: fixtures.invoiceStatusApprovedId,
        submittedAt: new Date(),
        submittedTotal: '75.00',
        caseId,
      },
      {
        submittedByUserAccountId: fixtures.staffUserAccountId,
        professionalId,
        statusId: fixtures.invoiceStatusSubmittedId,
        submittedAt: new Date(),
        submittedTotal: '50.00',
        caseId,
      },
    ]);
    expect(await stageOf(caseId)).toBe('billing');
  });

  it('has no stage once the case is closed', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await testDb.update(caseTable).set({ closedOn: '2026-02-01' }).where(eq(caseTable.caseId, caseId));
    expect(await stageOf(caseId)).toBeNull();
  });

  async function createProfessional(): Promise<string> {
    const email = `vendor-${randomUUID()}@example.com`;
    const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
    if (!account) {
      throw new Error('Expected insert to return a row.');
    }
    return ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
  }
});
