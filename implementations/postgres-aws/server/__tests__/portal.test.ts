import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createTimeEntry } from '../src/portal/createTimeEntry';
import { createInvoice } from '../src/portal/createInvoice';
import { ValidationError } from '../src/errors';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';
import { caseAssignment, invoiceLine, timeEntry, userAccount } from '../src/db/schema';

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

async function createCaseAssignedTo(professionalId: string): Promise<string> {
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
  await testDb.insert(caseAssignment).values({
    caseId,
    professionalId,
    assignedAt: new Date(),
    assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
    assignedByUserAccountId: fixtures.staffUserAccountId,
  });
  return caseId;
}

async function createVendorProfessional(email: string): Promise<{ userAccountId: string; professionalId: string }> {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  const professionalId = await ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
  return { userAccountId: account.userAccountId, professionalId };
}

describe('createTimeEntry', () => {
  it('logs time against a case the professional is assigned to', async () => {
    const { professionalId } = await createVendorProfessional('vendor1@example.com');
    const caseId = await createCaseAssignedTo(professionalId);

    const result = await createTimeEntry(testDb, { professionalId }, {
      caseId,
      activityOn: '2026-02-01',
      durationHours: 3.5,
      description: 'Client intake call',
    });

    const [row] = await testDb.select().from(timeEntry).where(eq(timeEntry.timeEntryId, result.timeEntryId));
    expect(row?.caseId).toBe(caseId);
    expect(row?.durationHours).toBe('3.50');
  });

  it('rejects a case the professional is not assigned to', async () => {
    const { professionalId } = await createVendorProfessional('vendor2@example.com');
    const { caseId: unassignedCaseId } = await createCase(
      testDb,
      { userAccountId: fixtures.staffUserAccountId },
      baseCaseInput(),
    );

    await expect(
      createTimeEntry(testDb, { professionalId }, {
        caseId: unassignedCaseId,
        activityOn: '2026-02-01',
        durationHours: 1,
        description: 'Should not be allowed',
      }),
    ).rejects.toThrow(NotAssignedToCaseError);
  });

  it('rejects malformed input before touching the database', async () => {
    const { professionalId } = await createVendorProfessional('vendor3@example.com');

    await expect(
      createTimeEntry(testDb, { professionalId }, { caseId: 'not-a-uuid', durationHours: -1 }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('createInvoice', () => {
  it('computes submittedTotal from line amounts, ignoring any client-sent total', async () => {
    const { userAccountId, professionalId } = await createVendorProfessional('vendor4@example.com');
    const caseId = await createCaseAssignedTo(professionalId);

    const result = await createInvoice(testDb, { userAccountId, professionalId }, {
      caseId,
      lines: [{ amount: 100 }, { amount: 50.5 }],
      // A client-sent total, if present, must be ignored — not part of
      // CreateInvoiceInput's type, so this only exercises the runtime
      // behavior (extra JSON fields a real HTTP body could include).
      submittedTotal: 999999,
    });

    expect(result.submittedTotal).toBe('150.50');
  });

  it('links a line to the submitter\'s own time entry for context', async () => {
    const { userAccountId, professionalId } = await createVendorProfessional('vendor5@example.com');
    const caseId = await createCaseAssignedTo(professionalId);
    const { timeEntryId } = await createTimeEntry(testDb, { professionalId }, {
      caseId,
      activityOn: '2026-02-01',
      durationHours: 2,
      description: 'Document review',
    });

    const result = await createInvoice(testDb, { userAccountId, professionalId }, {
      caseId,
      lines: [{ amount: 200, sourceTimeEntryId: timeEntryId }],
    });

    expect(result.submittedTotal).toBe('200.00');
  });

  it("rejects a line referencing someone else's time entry", async () => {
    const other = await createVendorProfessional('vendor6@example.com');
    const otherCaseId = await createCaseAssignedTo(other.professionalId);
    const { timeEntryId: othersTimeEntryId } = await createTimeEntry(testDb, { professionalId: other.professionalId }, {
      caseId: otherCaseId,
      activityOn: '2026-02-01',
      durationHours: 1,
      description: "Someone else's entry",
    });

    const { userAccountId, professionalId } = await createVendorProfessional('vendor7@example.com');
    const caseId = await createCaseAssignedTo(professionalId);

    await expect(
      createInvoice(testDb, { userAccountId, professionalId }, {
        caseId,
        lines: [{ amount: 100, sourceTimeEntryId: othersTimeEntryId }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a case the professional is not assigned to', async () => {
    const { userAccountId, professionalId } = await createVendorProfessional('vendor8@example.com');
    const { caseId: unassignedCaseId } = await createCase(
      testDb,
      { userAccountId: fixtures.staffUserAccountId },
      baseCaseInput(),
    );

    await expect(
      createInvoice(testDb, { userAccountId, professionalId }, {
        caseId: unassignedCaseId,
        lines: [{ amount: 100 }],
      }),
    ).rejects.toThrow(NotAssignedToCaseError);
  });

  it('keeps submittedTotal equal to the sum of its own persisted lines even with float-rounding-prone amounts', async () => {
    const { userAccountId, professionalId } = await createVendorProfessional('vendor9@example.com');
    const caseId = await createCaseAssignedTo(professionalId);

    const result = await createInvoice(testDb, { userAccountId, professionalId }, {
      caseId,
      lines: [{ amount: 10.005 }, { amount: 10.005 }],
    });

    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, result.invoiceId));
    const sumOfLines = lines.reduce((sum, line) => sum + Number(line.amount), 0);
    expect(Number(result.submittedTotal)).toBeCloseTo(sumOfLines, 2);
  });
});

// Exercised directly against the table, not through
// POST /:id/external-assignments (src/routes/cases.ts): there's no HTTP
// test harness in this project (see __tests__/createCase.test.ts and
// siblings, all handler-level), and the route's own duplicate-handling
// is just a catch around this same constraint.
describe('case_assignment_open_unique', () => {
  it('rejects a second open assignment for the same case/professional pair', async () => {
    const { professionalId } = await createVendorProfessional('vendor-dup@example.com');
    const caseId = await createCaseAssignedTo(professionalId);

    await expect(
      testDb.insert(caseAssignment).values({
        caseId,
        professionalId,
        assignedAt: new Date(),
        assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
        assignedByUserAccountId: fixtures.staffUserAccountId,
      }),
    ).rejects.toThrow();
  });
});
