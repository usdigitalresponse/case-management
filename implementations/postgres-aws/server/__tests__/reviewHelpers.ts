import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { testDb } from './testDb';
import { userAccount } from '../src/db/schema';
import { getSeededRoleId } from '../src/db/referenceLookups';
import { ADMIN_ACCOUNT_ROLE_DISPLAY_NAME, STAFF_ACCOUNT_ROLE_DISPLAY_NAME } from '../src/auth/staffAccountRole';

// reviewer and approver name what a test has them do; every staff member may do both.
const ROLE_NAMES = {
  reviewer: STAFF_ACCOUNT_ROLE_DISPLAY_NAME,
  approver: STAFF_ACCOUNT_ROLE_DISPLAY_NAME,
  staff: STAFF_ACCOUNT_ROLE_DISPLAY_NAME,
  admin: ADMIN_ACCOUNT_ROLE_DISPLAY_NAME,
};

export async function giveRole(userAccountId: string, roleKey: keyof typeof ROLE_NAMES): Promise<void> {
  const systemRoleId = await getSeededRoleId(testDb, ROLE_NAMES[roleKey], 'user_account');
  await testDb.update(userAccount).set({ systemRoleId }).where(eq(userAccount.userAccountId, userAccountId));
}

export async function createStaff(roleKey: keyof typeof ROLE_NAMES, displayName = `Staff ${randomUUID().slice(0, 6)}`) {
  const email = `staff-${randomUUID()}@example.invalid`;
  const [account] = await testDb.insert(userAccount).values({ displayName, email, active: true }).returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  await giveRole(account.userAccountId, roleKey);
  return account.userAccountId;
}
