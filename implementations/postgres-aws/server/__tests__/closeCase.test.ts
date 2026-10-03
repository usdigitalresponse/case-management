import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { closeCase, CloseCaseValidationError } from '../src/cases/closeCase';
import { CaseAlreadyClosedError, CaseNotFoundError } from '../src/cases/errors';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { calendarDateInReportingTimeZone } from '../src/reportingTimeZone';
import { caseTable, caseAssignment, caseLifecycleEvent, userAccount } from '../src/db/schema';

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

async function createProfessional(): Promise<string> {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  return ensureProfessionalForUserAccount(testDb, account.userAccountId, email);
}

describe('closeCase', () => {
  it('sets closedOn, the closed status, and records a lifecycle event', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());

    const before = new Date();
    const result = await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Matter resolved.' });

    expect(result.closedOn).toBe(calendarDateInReportingTimeZone(before));
    const [caseRow] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, caseId));
    expect(caseRow?.closedOn).toBe(result.closedOn);
    expect(caseRow?.statusId).toBe(fixtures.caseStatusClosedId);

    const [event] = await testDb
      .select()
      .from(caseLifecycleEvent)
      .where(eq(caseLifecycleEvent.caseLifecycleEventId, result.caseLifecycleEventId));
    expect(event?.sequenceNumber).toBe(2);
    expect(event?.reasonDetail).toBe('Matter resolved.');
    expect(event?.resultingStatusId).toBe(fixtures.caseStatusClosedId);
    expect(event?.effectiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('ignores a client-supplied effectiveAt', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());

    const result = await closeCase(testDb, fixtures.staffUserAccountId, caseId, {
      reasonDetail: 'Done.',
      effectiveAt: '2020-01-01T00:00:00Z',
    });

    expect(result.closedOn).not.toBe('2020-01-01');
  });

  it('ends every open assignment at the closure timestamp', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const professionalId = await createProfessional();
    const [assignment] = await testDb
      .insert(caseAssignment)
      .values({
        caseId,
        professionalId,
        assignedAt: new Date('2026-01-20T00:00:00Z'),
        assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
        assignedByUserAccountId: fixtures.staffUserAccountId,
      })
      .returning();

    const result = await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Done.' });
    const [event] = await testDb
      .select()
      .from(caseLifecycleEvent)
      .where(eq(caseLifecycleEvent.caseLifecycleEventId, result.caseLifecycleEventId));

    const [row] = await testDb
      .select()
      .from(caseAssignment)
      .where(eq(caseAssignment.caseAssignmentId, assignment!.caseAssignmentId));
    expect(row?.endedAt).toEqual(event?.effectiveAt);
    expect(row?.endedByUserAccountId).toBe(fixtures.staffUserAccountId);
    expect(row?.endReason).toBe('Case closed');
  });

  it('does not touch an assignment that already ended', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const professionalId = await createProfessional();
    const priorEndedAt = new Date('2026-02-01T00:00:00Z');
    const [assignment] = await testDb
      .insert(caseAssignment)
      .values({
        caseId,
        professionalId,
        assignedAt: new Date('2026-01-20T00:00:00Z'),
        endedAt: priorEndedAt,
        endedByUserAccountId: fixtures.staffUserAccountId,
        endReason: 'Reassigned',
        assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
        assignedByUserAccountId: fixtures.staffUserAccountId,
      })
      .returning();

    await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Done.' });

    const [row] = await testDb
      .select()
      .from(caseAssignment)
      .where(eq(caseAssignment.caseAssignmentId, assignment!.caseAssignmentId));
    expect(row?.endedAt).toEqual(priorEndedAt);
    expect(row?.endReason).toBe('Reassigned');
  });

  it('requires a reason', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());

    await expect(closeCase(testDb, fixtures.staffUserAccountId, caseId, {})).rejects.toThrow(CloseCaseValidationError);
  });

  it('rejects an unknown case', async () => {
    await expect(
      closeCase(testDb, fixtures.staffUserAccountId, '00000000-0000-0000-0000-000000000000', { reasonDetail: 'x' }),
    ).rejects.toThrow(CaseNotFoundError);
  });

  it('rejects closing an already-closed case', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'First closure.' });

    await expect(
      closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Second closure.' }),
    ).rejects.toThrow(CaseAlreadyClosedError);
  });

  it('lets exactly one of two concurrent closes win', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());

    const results = await Promise.allSettled([
      closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'First.' }),
      closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Second.' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(CaseAlreadyClosedError);
  });

  it('uses the next sequence number after the opening event', async () => {
    const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseCaseInput());
    const events = await testDb.select().from(caseLifecycleEvent).where(eq(caseLifecycleEvent.caseId, caseId));
    expect(events).toHaveLength(1);
    expect(events[0]?.sequenceNumber).toBe(1);

    const result = await closeCase(testDb, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Done.' });
    const [closingEvent] = await testDb
      .select()
      .from(caseLifecycleEvent)
      .where(eq(caseLifecycleEvent.caseLifecycleEventId, result.caseLifecycleEventId));
    expect(closingEvent?.sequenceNumber).toBe(2);
  });
});
