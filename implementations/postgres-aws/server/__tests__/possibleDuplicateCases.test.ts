import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { pool } from '../src/db/client';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { caseTable, county } from '../src/db/schema';
import { caseDuplicateMembers, listPossibleDuplicateCases, recordCaseDuplicateReview } from '../src/cases/possibleDuplicateCases';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await pool.end();
  await testPool.end();
});

async function addCase(caseNumber: string, countyId: string | null = fixtures.countyId) {
  const { caseId } = await createCase(
    testDb,
    { userAccountId: fixtures.staffUserAccountId },
    {
      requestId: randomUUID(),
      personId: fixtures.clientPersonId,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-15T12:00:00Z'),
      caseNumber,
      countyId: countyId ?? undefined,
    },
  );
  return caseId;
}

describe('possible duplicate cases', () => {
  it('groups open cases whose numbers match ignoring punctuation and leading zeros', async () => {
    const a = await addCase('26-CR-0418');
    const b = await addCase('26CR418');
    const c = await addCase('26 cr 00418');
    await addCase('26-CR-0419');

    const [group, ...others] = await listPossibleDuplicateCases(testDb);
    expect(others).toEqual([]);
    expect(group?.cases.map((one) => one.caseId).sort()).toEqual([a, b, c].sort());
    expect(group?.pairs.every((pair) => pair.reasons.join() === 'same_number,same_county')).toBe(true);
    expect(group?.cases.find((one) => one.caseId === a)?.caseNumber).toBe('26-CR-0418');
  });

  it('tell each case which others it may be, for the notice on its page', async () => {
    const a = await addCase('26-CR-0418');
    const b = await addCase('26CR418');
    await addCase('26-CR-0419');

    const members = caseDuplicateMembers(await listPossibleDuplicateCases(testDb));
    expect(members.get(a)).toEqual([{ id: b, label: '26CR418' }]);
    expect(members.get(b)).toEqual([{ id: a, label: '26-CR-0418' }]);
    expect(members.size).toBe(2);
  });

  it('never pairs cases in different counties, even when flagged', async () => {
    const staff = await createStaff('staff');
    const [other] = await testDb.insert(county).values({ displayName: 'Another county' }).returning();
    const here = await addCase('26-CR-0418');
    const there = await addCase('26CR418', other!.countyId);
    expect(await listPossibleDuplicateCases(testDb)).toEqual([]);
    await expect(recordCaseDuplicateReview(testDb, staff, { caseIds: [here, there], outcome: 'possible_duplicate' })).rejects.toMatchObject({
      fieldErrors: { caseIds: 'These cases are in different counties, so they are different cases.' },
    });
    const withoutCounty = await addCase('26-cr-00418', null);
    const groups = await listPossibleDuplicateCases(testDb);
    expect(groups.flatMap((group) => group.pairs.map((pair) => pair.reasons))).toEqual([['same_number'], ['same_number']]);
    expect(groups[0]?.cases.map((record) => record.caseId)).toContain(withoutCounty);
  });

  it('drops a pair staff find different, or once one is closed', async () => {
    const staff = await createStaff('staff');
    const a = await addCase('26-CR-0418');
    const b = await addCase('26CR418');
    await recordCaseDuplicateReview(testDb, staff, { caseIds: [a, b], outcome: 'not_duplicate', note: 'Separate matters' });
    expect(await listPossibleDuplicateCases(testDb)).toEqual([]);

    const c = await addCase('25-CV-0001');
    const d = await addCase('25-CV-0099');
    await recordCaseDuplicateReview(testDb, staff, { caseIds: [d, c], outcome: 'possible_duplicate' });
    expect((await listPossibleDuplicateCases(testDb))[0]?.pairs[0]?.reasons).toEqual(['flagged']);
    await testDb.update(caseTable).set({ closedOn: '2026-02-01' }).where(eq(caseTable.caseId, c));
    expect(await listPossibleDuplicateCases(testDb)).toEqual([]);
  });
});
