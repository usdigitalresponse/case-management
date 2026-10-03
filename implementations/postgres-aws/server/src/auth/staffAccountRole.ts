// The user_account-context role marking a full (SSO) user as staff,
// distinguishing them from an external vendor's user_account (created by
// the magic-link flow, ../routes/auth.ts, which never sets this). Needed
// so ../routes/staff.ts can search "who is staff" without inferring it
// from the presence/absence of a professional row.
import type { Database } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';

export const STAFF_ACCOUNT_ROLE_DISPLAY_NAME = 'Intake Staff';

export function getStaffAccountRoleId(db: Database): Promise<string> {
  return getSeededRoleId(db, STAFF_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}
