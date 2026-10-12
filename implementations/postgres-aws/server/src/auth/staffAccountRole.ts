// The user_account-context roles marking a full (SSO) user as staff,
// distinguishing them from an external vendor's user_account (created by
// the magic-link flow, ../routes/auth.ts, which never sets one). Needed
// so ../routes/staff.ts can search "who is staff" without inferring it
// from the presence/absence of a professional row. An administrator is
// staff who may also change settings (./requireAdmin.ts); how other roles
// map to permissions is still undecided (model/README.md).
import type { DatabaseOrTransaction } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';

export const STAFF_ACCOUNT_ROLE_DISPLAY_NAME = 'Intake Staff';
export const ADMIN_ACCOUNT_ROLE_DISPLAY_NAME = 'Administrator';

// The role new SSO accounts get.
export function getStaffAccountRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, STAFF_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}

export function getAdminAccountRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, ADMIN_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}

// Every role that makes an account staff.
export async function getStaffAccountRoleIds(db: DatabaseOrTransaction): Promise<string[]> {
  return Promise.all([getStaffAccountRoleId(db), getAdminAccountRoleId(db)]);
}
