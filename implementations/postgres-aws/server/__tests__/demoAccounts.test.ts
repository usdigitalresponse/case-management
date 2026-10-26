// MAPPING.md "Demo sign-in": only seeded example.invalid accounts are offered.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { listDemoPartners, listDemoStaff } from '../src/auth/demoAccounts';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

describe('demo sign-in accounts', () => {
  it('offers seeded staff with their role, and seeded vendors, but never real accounts', async () => {
    await ensureUserAccountForEmail(testDb, 'person@agency.example', 'Real Person', fixtures.intakeStaffRoleId);
    await ensureUserAccountForEmail(testDb, 'demo-vendor-1@example.invalid', 'Demo Vendor');

    const staff = await listDemoStaff(testDb);
    expect(staff.map((account) => account.userAccountId)).toEqual([fixtures.staffUserAccountId]);
    // A generated name, not a placeholder.
    expect(staff[0]?.displayName).not.toMatch(/synthetic/i);
    expect(staff[0]?.description).toBeTruthy();

    expect((await listDemoPartners(testDb)).map((account) => account.displayName)).toEqual(['Demo Vendor']);
  });
});
