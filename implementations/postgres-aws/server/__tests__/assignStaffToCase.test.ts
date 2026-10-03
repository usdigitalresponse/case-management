import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { assignStaffToCase, NotStaffAccountError } from '../src/cases/assignStaffToCase';
import { CaseAlreadyClosedError, CaseNotFoundError } from '../src/cases/errors';
import { closeCase } from '../src/cases/closeCase';
import { AlreadyAssignedError } from '../src/cases/assignProfessionalToCase';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { caseAssignment, professional } from '../src/db/schema';

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

describe('assignStaffToCase', () => {
  it('bootstraps a professional profile for a staff account that has never had one', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const staffAccount = await ensureUserAccountForEmail(
      testDb,
      'attorney1@usdigitalresponse.org',
      'Attorney One',
      fixtures.intakeStaffRoleId,
    );

    const assignment = await assignStaffToCase(testDb, fixtures.staffUserAccountId, {
      caseId,
      userAccountId: staffAccount.userAccountId,
    });

    expect(assignment.caseId).toBe(caseId);
    const [professionalRow] = await testDb
      .select()
      .from(professional)
      .where(eq(professional.userAccountId, staffAccount.userAccountId));
    expect(professionalRow?.professionalId).toBe(assignment.professionalId);
  });

  it('reuses the existing professional profile on a second assignment', async () => {
    const { caseId: caseId1 } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const { caseId: caseId2 } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const staffAccount = await ensureUserAccountForEmail(
      testDb,
      'attorney2@usdigitalresponse.org',
      'Attorney Two',
      fixtures.intakeStaffRoleId,
    );

    const first = await assignStaffToCase(testDb, fixtures.staffUserAccountId, {
      caseId: caseId1,
      userAccountId: staffAccount.userAccountId,
    });
    const second = await assignStaffToCase(testDb, fixtures.staffUserAccountId, {
      caseId: caseId2,
      userAccountId: staffAccount.userAccountId,
    });

    expect(second.professionalId).toBe(first.professionalId);
  });

  it('uses the "Assigned Staff" role, distinct from "External Submitter"', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const staffAccount = await ensureUserAccountForEmail(
      testDb,
      'attorney3@usdigitalresponse.org',
      'Attorney Three',
      fixtures.intakeStaffRoleId,
    );

    const assignment = await assignStaffToCase(testDb, fixtures.staffUserAccountId, {
      caseId,
      userAccountId: staffAccount.userAccountId,
    });

    expect(assignment.assignmentRoleId).toBe(fixtures.assignedStaffRoleId);
    expect(assignment.assignmentRoleId).not.toBe(fixtures.externalSubmitterAssignmentRoleId);
  });

  it('rejects a userAccountId that is not a staff account (e.g. an external vendor)', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const vendorAccount = await ensureUserAccountForEmail(testDb, 'vendor-not-staff@example.com', 'Some Vendor');
    await ensureProfessionalForUserAccount(testDb, vendorAccount.userAccountId, 'Some Vendor');

    await expect(
      assignStaffToCase(testDb, fixtures.staffUserAccountId, { caseId, userAccountId: vendorAccount.userAccountId }),
    ).rejects.toThrow(NotStaffAccountError);
  });

  it('rejects an unknown case', async () => {
    const staffAccount = await ensureUserAccountForEmail(
      testDb,
      'attorney4@usdigitalresponse.org',
      'Attorney Four',
      fixtures.intakeStaffRoleId,
    );

    await expect(
      assignStaffToCase(testDb, fixtures.staffUserAccountId, {
        caseId: '00000000-0000-0000-0000-000000000000',
        userAccountId: staffAccount.userAccountId,
      }),
    ).rejects.toThrow(CaseNotFoundError);
  });

  it('rejects a second open assignment of the same staff member to the same case', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const staffAccount = await ensureUserAccountForEmail(
      testDb,
      'attorney5@usdigitalresponse.org',
      'Attorney Five',
      fixtures.intakeStaffRoleId,
    );

    await assignStaffToCase(testDb, fixtures.staffUserAccountId, { caseId, userAccountId: staffAccount.userAccountId });

    await expect(
      assignStaffToCase(testDb, fixtures.staffUserAccountId, { caseId, userAccountId: staffAccount.userAccountId }),
    ).rejects.toThrow(AlreadyAssignedError);

    const rows = await testDb.select().from(caseAssignment).where(eq(caseAssignment.caseId, caseId));
    expect(rows).toHaveLength(1);
  });

  it('rejects assignment to a closed case', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Done.' });
    const staffAccount = await ensureUserAccountForEmail(
      testDb,
      'attorney6@usdigitalresponse.org',
      'Attorney Six',
      fixtures.intakeStaffRoleId,
    );

    await expect(
      assignStaffToCase(testDb, fixtures.staffUserAccountId, { caseId, userAccountId: staffAccount.userAccountId }),
    ).rejects.toThrow(CaseAlreadyClosedError);

    const rows = await testDb.select().from(caseAssignment).where(eq(caseAssignment.caseId, caseId));
    expect(rows).toHaveLength(0);
  });
});
