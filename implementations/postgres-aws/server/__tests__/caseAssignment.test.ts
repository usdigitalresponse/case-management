import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { assignStaffToCase, NotStaffAccountError } from '../src/cases/assignStaffToCase';
import {
  assignExternalSubmitterToCase,
  NotExternalProfessionalError,
} from '../src/cases/assignExternalSubmitterToCase';
import { CaseAlreadyClosedError, CaseNotFoundError } from '../src/cases/errors';
import { closeCase } from '../src/cases/closeCase';
import { AlreadyAssignedError } from '../src/cases/assignProfessionalToCase';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { ValidationError } from '../src/errors';
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

async function openCase(): Promise<string> {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
  return caseId;
}

async function createStaffAccount(email: string): Promise<string> {
  const account = await ensureUserAccountForEmail(testDb, email, email, fixtures.intakeStaffRoleId);
  return account.userAccountId;
}

async function createVendorProfessional(email: string): Promise<string> {
  const account = await ensureUserAccountForEmail(testDb, email);
  return ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
}

function assignStaff(caseId: string, userAccountId: string) {
  return assignStaffToCase(testDb, fixtures.staffUserAccountId, caseId, { userAccountId });
}

function assignExternal(caseId: string, professionalId: string) {
  return assignExternalSubmitterToCase(testDb, fixtures.staffUserAccountId, caseId, { professionalId });
}

describe('assignStaffToCase', () => {
  it('bootstraps a professional profile for a staff account that has never had one', async () => {
    const caseId = await openCase();
    const userAccountId = await createStaffAccount('attorney1@usdigitalresponse.org');

    const assignment = await assignStaff(caseId, userAccountId);

    expect(assignment.caseId).toBe(caseId);
    const [professionalRow] = await testDb.select().from(professional).where(eq(professional.userAccountId, userAccountId));
    expect(professionalRow?.professionalId).toBe(assignment.professionalId);
  });

  it('reuses the existing professional profile on a second assignment', async () => {
    const userAccountId = await createStaffAccount('attorney2@usdigitalresponse.org');

    const first = await assignStaff(await openCase(), userAccountId);
    const second = await assignStaff(await openCase(), userAccountId);

    expect(second.professionalId).toBe(first.professionalId);
  });

  it('uses the "Assigned Staff" role, distinct from "External Submitter"', async () => {
    const assignment = await assignStaff(await openCase(), await createStaffAccount('attorney3@usdigitalresponse.org'));

    expect(assignment.assignmentRoleId).toBe(fixtures.assignedStaffRoleId);
    expect(assignment.assignmentRoleId).not.toBe(fixtures.externalSubmitterAssignmentRoleId);
  });

  it('rejects a userAccountId that is not a staff account (e.g. an external vendor)', async () => {
    const vendorAccount = await ensureUserAccountForEmail(testDb, 'vendor-not-staff@example.com');

    await expect(assignStaff(await openCase(), vendorAccount.userAccountId)).rejects.toThrow(NotStaffAccountError);
  });

  it('requires a userAccountId', async () => {
    await expect(
      assignStaffToCase(testDb, fixtures.staffUserAccountId, await openCase(), {}),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an unknown case', async () => {
    const userAccountId = await createStaffAccount('attorney4@usdigitalresponse.org');

    await expect(assignStaff('00000000-0000-0000-0000-000000000000', userAccountId)).rejects.toThrow(CaseNotFoundError);
  });

  it('rejects a second open assignment of the same staff member to the same case', async () => {
    const caseId = await openCase();
    const userAccountId = await createStaffAccount('attorney5@usdigitalresponse.org');

    await assignStaff(caseId, userAccountId);
    await expect(assignStaff(caseId, userAccountId)).rejects.toThrow(AlreadyAssignedError);

    const rows = await testDb.select().from(caseAssignment).where(eq(caseAssignment.caseId, caseId));
    expect(rows).toHaveLength(1);
  });

  it('rejects assignment to a closed case', async () => {
    const caseId = await openCase();
    await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Done.' });

    await expect(assignStaff(caseId, await createStaffAccount('attorney6@usdigitalresponse.org'))).rejects.toThrow(
      CaseAlreadyClosedError,
    );

    const rows = await testDb.select().from(caseAssignment).where(eq(caseAssignment.caseId, caseId));
    expect(rows).toHaveLength(0);
  });
});

describe('assignExternalSubmitterToCase', () => {
  it('assigns a vendor professional with the "External Submitter" role', async () => {
    const caseId = await openCase();
    const professionalId = await createVendorProfessional('vendor1@example.com');

    const assignment = await assignExternal(caseId, professionalId);

    expect(assignment.caseId).toBe(caseId);
    expect(assignment.professionalId).toBe(professionalId);
    expect(assignment.assignmentRoleId).toBe(fixtures.externalSubmitterAssignmentRoleId);
  });

  it("rejects a staff member's professional profile", async () => {
    const userAccountId = await createStaffAccount('attorney7@usdigitalresponse.org');
    const { professionalId } = await assignStaff(await openCase(), userAccountId);

    await expect(assignExternal(await openCase(), professionalId)).rejects.toThrow(NotExternalProfessionalError);
  });

  it('rejects an unknown professionalId', async () => {
    await expect(assignExternal(await openCase(), randomUUID())).rejects.toThrow(ValidationError);
  });

  it('rejects an unknown case', async () => {
    const professionalId = await createVendorProfessional('vendor2@example.com');

    await expect(assignExternal('00000000-0000-0000-0000-000000000000', professionalId)).rejects.toThrow(
      CaseNotFoundError,
    );
  });

  it('rejects assignment to a closed case', async () => {
    const caseId = await openCase();
    await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Done.' });

    await expect(assignExternal(caseId, await createVendorProfessional('vendor3@example.com'))).rejects.toThrow(
      CaseAlreadyClosedError,
    );
  });
});
