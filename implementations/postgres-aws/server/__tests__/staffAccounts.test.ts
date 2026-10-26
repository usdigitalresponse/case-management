// Administrators add staff before their first sign-in, and deactivate them.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import {
  addStaffAccount,
  getBillingReviewerRoleId,
  getStaffAccountRoleId,
  listStaffAccounts,
  setStaffActive,
} from '../src/auth/staffAccountRole';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';
import { isStaffAccount } from '../src/portal/portalActor';
import { ValidationError } from '../src/errors';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

describe('staff accounts', () => {
  it('adds a staff account whose first sign-in keeps the chosen role, and refuses a duplicate email', async () => {
    const admin = fixtures.staffUserAccountId;
    const roleId = await getBillingReviewerRoleId(testDb);
    const { userAccountId } = await addStaffAccount(testDb, admin, { displayName: 'Synthetic Reviewer', email: 'Reviewer@Example.com', roleId });
    await expect(
      addStaffAccount(testDb, admin, { displayName: 'Again', email: 'reviewer@example.com', roleId }),
    ).rejects.toThrow(ValidationError);

    // Sign-in gives a new account the default role, but never replaces one.
    const signedIn = await ensureUserAccountForEmail(testDb, 'reviewer@example.com', 'From SSO', await getStaffAccountRoleId(testDb));
    expect(signedIn).toMatchObject({ userAccountId, systemRoleId: roleId, displayName: 'Synthetic Reviewer' });
  });

  it('deactivates and reactivates staff, but not oneself', async () => {
    const admin = fixtures.staffUserAccountId;
    const { userAccountId } = await addStaffAccount(testDb, admin, {
      displayName: 'Synthetic Staff',
      email: 'synthetic.staff@example.com',
      roleId: await getStaffAccountRoleId(testDb),
    });
    await expect(setStaffActive(testDb, admin, admin, { active: false })).rejects.toThrow(ValidationError);

    await setStaffActive(testDb, admin, userAccountId, { active: false });
    expect(await isStaffAccount(testDb, userAccountId)).toBe(false);
    expect((await listStaffAccounts(testDb)).find((row) => row.userAccountId === userAccountId)?.active).toBe(false);

    await setStaffActive(testDb, admin, userAccountId, { active: true });
    expect(await isStaffAccount(testDb, userAccountId)).toBe(true);
  });
});
