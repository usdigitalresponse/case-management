// Administrators add staff before their first sign-in, and deactivate them;
// on demo servers staff switch their own role.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { role, userAccount } from '../src/db/schema';
import {
  addStaffAccount,
  getAdminAccountRoleId,
  getStaffAccountRoleId,
  listStaffAccounts,
  listStaffRoles,
  RETIRED_STAFF_ROLE_DISPLAY_NAMES,
  setOwnDemoRole,
  setStaffActive,
  setStaffRole,
  STAFF_ACCOUNT_ROLE_DISPLAY_NAME,
} from '../src/auth/staffAccountRole';
import { loadReviewPermissions } from '../src/billing/reviewAccess';
import { isAdmin } from '../src/auth/requireAdmin';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';
import { isStaffAccount } from '../src/portal/portalActor';
import { NotFoundError, ValidationError } from '../src/errors';

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
    const roleId = await getAdminAccountRoleId(testDb);
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

  it('offers only Staff and Administrator, and keeps an account with a retired role working as Staff', async () => {
    const admin = fixtures.staffUserAccountId;
    const staffRoleId = await getStaffAccountRoleId(testDb);
    expect((await listStaffRoles(testDb)).map((row) => row.displayName)).toEqual([STAFF_ACCOUNT_ROLE_DISPLAY_NAME, 'Administrator']);

    await testDb
      .insert(role)
      .values({ displayName: RETIRED_STAFF_ROLE_DISPLAY_NAMES[1]!, roleContext: 'user_account', active: false })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] });
    const [retired] = await testDb
      .select({ roleId: role.roleId })
      .from(role)
      .where(and(eq(role.displayName, RETIRED_STAFF_ROLE_DISPLAY_NAMES[1]!), eq(role.roleContext, 'user_account')));
    const [account] = await testDb
      .insert(userAccount)
      .values({ displayName: 'Former Reviewer', email: 'former.reviewer@example.com', active: true, systemRoleId: retired!.roleId })
      .returning();

    expect(await isStaffAccount(testDb, account!.userAccountId)).toBe(true);
    expect(await loadReviewPermissions(testDb, account!.userAccountId)).toEqual({ reviewLines: true, signOff: true, reassign: true, changeSettings: false });
    expect((await listStaffAccounts(testDb)).find((row) => row.userAccountId === account!.userAccountId)?.roleId).toBe(staffRoleId);
    // A retired role can't be given again.
    await expect(setStaffRole(testDb, admin, account!.userAccountId, { roleId: retired!.roleId })).rejects.toThrow(ValidationError);
    await setStaffRole(testDb, admin, account!.userAccountId, { roleId: staffRoleId });
  });

  it('lets anyone switch their own demo role, administrator included, but never makes an external account staff', async () => {
    const self = fixtures.staffUserAccountId;
    const adminRoleId = await getAdminAccountRoleId(testDb);
    const reviewerRoleId = await getStaffAccountRoleId(testDb);
    await setOwnDemoRole(testDb, self, { roleId: adminRoleId });
    // An administrator can't demote themselves through the regular setting...
    await expect(setStaffRole(testDb, self, self, { roleId: reviewerRoleId })).rejects.toThrow(ValidationError);
    // ...but can through the demo one, and switch back.
    await setOwnDemoRole(testDb, self, { roleId: reviewerRoleId });
    expect(await isAdmin(testDb, self)).toBe(false);
    await setOwnDemoRole(testDb, self, { roleId: adminRoleId });
    expect(await isAdmin(testDb, self)).toBe(true);

    const external = await ensureUserAccountForEmail(testDb, 'vendor@example.com', 'Synthetic Vendor');
    await expect(setOwnDemoRole(testDb, external.userAccountId, { roleId: adminRoleId })).rejects.toThrow(NotFoundError);
  });
});
