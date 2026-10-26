// The user_account-context roles marking a full (SSO) user as staff,
// distinguishing them from an external vendor's user_account (created by
// the magic-link flow, ../routes/auth.ts, which never sets one). Needed
// so ../routes/staff.ts can search "who is staff" without inferring it
// from the presence/absence of a professional row. reviewPermissions maps
// each role to review actions (model/rules.yaml authorize_invoice_review).
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';
import { auditEvent, role, userAccount } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

// General staff: reads the review queue; their other work is not yet defined.
export const STAFF_ACCOUNT_ROLE_DISPLAY_NAME = 'Intake Staff';
export const ADMIN_ACCOUNT_ROLE_DISPLAY_NAME = 'Administrator';
export const BILLING_REVIEWER_ROLE_DISPLAY_NAME = 'Billing Reviewer';
export const SIGN_OFF_APPROVER_ROLE_DISPLAY_NAME = 'Sign-off Approver';

const STAFF_ROLE_DISPLAY_NAMES = [
  STAFF_ACCOUNT_ROLE_DISPLAY_NAME,
  BILLING_REVIEWER_ROLE_DISPLAY_NAME,
  SIGN_OFF_APPROVER_ROLE_DISPLAY_NAME,
  ADMIN_ACCOUNT_ROLE_DISPLAY_NAME,
];

export interface ReviewPermissions {
  reviewLines: boolean;
  signOff: boolean;
  reassign: boolean;
  changeSettings: boolean;
}

const NO_PERMISSIONS: ReviewPermissions = { reviewLines: false, signOff: false, reassign: false, changeSettings: false };

const PERMISSIONS_BY_ROLE: Record<string, ReviewPermissions> = {
  [STAFF_ACCOUNT_ROLE_DISPLAY_NAME]: NO_PERMISSIONS,
  [BILLING_REVIEWER_ROLE_DISPLAY_NAME]: { reviewLines: true, signOff: false, reassign: true, changeSettings: false },
  [SIGN_OFF_APPROVER_ROLE_DISPLAY_NAME]: { reviewLines: false, signOff: true, reassign: true, changeSettings: false },
  [ADMIN_ACCOUNT_ROLE_DISPLAY_NAME]: { reviewLines: true, signOff: true, reassign: true, changeSettings: true },
};

export function reviewPermissionsForRole(roleDisplayName: string | null | undefined): ReviewPermissions {
  return (roleDisplayName && PERMISSIONS_BY_ROLE[roleDisplayName]) || NO_PERMISSIONS;
}

// The role new SSO accounts get.
export function getStaffAccountRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, STAFF_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}

export function getAdminAccountRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, ADMIN_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}

export function getBillingReviewerRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, BILLING_REVIEWER_ROLE_DISPLAY_NAME, 'user_account');
}

export function getSignOffApproverRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, SIGN_OFF_APPROVER_ROLE_DISPLAY_NAME, 'user_account');
}

// Every role that makes an account staff.
export async function getStaffAccountRoleIds(db: DatabaseOrTransaction): Promise<string[]> {
  const rows = await db
    .select({ roleId: role.roleId })
    .from(role)
    .where(inArray(role.displayName, STAFF_ROLE_DISPLAY_NAMES));
  return rows.map((row) => row.roleId);
}

// An administrator changes a staff account's role; external accounts never
// become staff this way, and no one removes their own administrator role.
export async function setStaffRole(db: Database, adminUserAccountId: string, userAccountId: string, rawInput: unknown) {
  const parsed = z.object({ roleId: z.uuid() }).safeParse(rawInput);
  if (!parsed.success || !z.uuid().safeParse(userAccountId).success) {
    throw new ValidationError({ roleId: 'Choose a role.' });
  }
  const staffRoleIds = await getStaffAccountRoleIds(db);
  if (!staffRoleIds.includes(parsed.data.roleId)) {
    throw new ValidationError({ roleId: 'Choose a staff role.' });
  }
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ systemRoleId: userAccount.systemRoleId })
      .from(userAccount)
      .where(eq(userAccount.userAccountId, userAccountId))
      .for('update');
    if (!account?.systemRoleId || !staffRoleIds.includes(account.systemRoleId)) {
      throw new NotFoundError('Staff account not found.');
    }
    if (userAccountId === adminUserAccountId && parsed.data.roleId !== (await getAdminAccountRoleId(tx))) {
      throw new ValidationError({ roleId: 'Ask another administrator to change your own role.' });
    }
    if (account.systemRoleId === parsed.data.roleId) {
      return { userAccountId, roleId: parsed.data.roleId };
    }
    await tx.update(userAccount).set({ systemRoleId: parsed.data.roleId }).where(eq(userAccount.userAccountId, userAccountId));
    await tx.insert(auditEvent).values({
      entityType: 'user_account',
      entityId: userAccountId,
      eventType: 'system_role_changed',
      actorUserAccountId: adminUserAccountId,
      occurredAt: new Date(),
      priorValues: { system_role_id: account.systemRoleId },
    });
    return { userAccountId, roleId: parsed.data.roleId };
  });
}

export async function listStaffRoles(db: DatabaseOrTransaction) {
  const rows = await db
    .select({ roleId: role.roleId, displayName: role.displayName })
    .from(role)
    .where(inArray(role.displayName, STAFF_ROLE_DISPLAY_NAMES));
  return STAFF_ROLE_DISPLAY_NAMES.flatMap((name) => rows.filter((row) => row.displayName === name));
}
