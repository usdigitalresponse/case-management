// The account roles that make an SSO user staff; external accounts never have one. reviewPermissions maps
// each to review actions (model/rules.yaml authorize_invoice_review).
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';
import { firstRow } from '../db/rowHelpers';
import { auditEvent, role, userAccount } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';

// Every staff member reviews, signs off and uploads; administrators also
// change settings.
export const STAFF_ACCOUNT_ROLE_DISPLAY_NAME = 'Staff';
export const ADMIN_ACCOUNT_ROLE_DISPLAY_NAME = 'Administrator';
// Retired by migration 0034, kept so accounts that still have them stay staff
// and their history stays readable; never offered.
export const RETIRED_STAFF_ROLE_DISPLAY_NAMES = ['Intake Staff', 'Billing Reviewer', 'Sign-off Approver'];

const OFFERED_STAFF_ROLE_DISPLAY_NAMES = [STAFF_ACCOUNT_ROLE_DISPLAY_NAME, ADMIN_ACCOUNT_ROLE_DISPLAY_NAME];

export function shownRoleName(roleDisplayName: string): string {
  return RETIRED_STAFF_ROLE_DISPLAY_NAMES.includes(roleDisplayName) ? STAFF_ACCOUNT_ROLE_DISPLAY_NAME : roleDisplayName;
}
const STAFF_ROLE_DISPLAY_NAMES = [...OFFERED_STAFF_ROLE_DISPLAY_NAMES, ...RETIRED_STAFF_ROLE_DISPLAY_NAMES];

export interface ReviewPermissions {
  reviewLines: boolean;
  signOff: boolean;
  reassign: boolean;
  changeSettings: boolean;
}

const NO_PERMISSIONS: ReviewPermissions = { reviewLines: false, signOff: false, reassign: false, changeSettings: false };
const STAFF_PERMISSIONS: ReviewPermissions = { reviewLines: true, signOff: true, reassign: true, changeSettings: false };

const PERMISSIONS_BY_ROLE: Record<string, ReviewPermissions> = {
  ...Object.fromEntries([STAFF_ACCOUNT_ROLE_DISPLAY_NAME, ...RETIRED_STAFF_ROLE_DISPLAY_NAMES].map((name) => [name, STAFF_PERMISSIONS])),
  [ADMIN_ACCOUNT_ROLE_DISPLAY_NAME]: { ...STAFF_PERMISSIONS, changeSettings: true },
};

export function reviewPermissionsForRole(roleDisplayName: string | null | undefined): ReviewPermissions {
  return (roleDisplayName && PERMISSIONS_BY_ROLE[roleDisplayName]) || NO_PERMISSIONS;
}

// The intended role for new SSO accounts, which for now are administrators (./oidcProviders.ts).
export function getStaffAccountRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, STAFF_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}

export function getAdminAccountRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, ADMIN_ACCOUNT_ROLE_DISPLAY_NAME, 'user_account');
}

// A condition on an account's system_role_id column: true for an external (non-staff) account.
export function isNotStaffRole(roleIdColumn: SQL): SQL {
  const names = sql.join(STAFF_ROLE_DISPLAY_NAMES.map((name) => sql`${name}`), sql`, `);
  return sql`(${roleIdColumn} is null or not exists (select 1 from role staff_role
    where staff_role.role_id = ${roleIdColumn} and staff_role.display_name in (${names})))`;
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
export function setStaffRole(db: Database, adminUserAccountId: string, userAccountId: string, rawInput: unknown) {
  return changeStaffRole(db, adminUserAccountId, userAccountId, rawInput, false);
}

// Demo servers only (../routes/settings.ts): any staff member switches their
// own role, administrator included, to try each view.
export function setOwnDemoRole(db: Database, userAccountId: string, rawInput: unknown) {
  return changeStaffRole(db, userAccountId, userAccountId, rawInput, true);
}

async function changeStaffRole(
  db: Database,
  actorUserAccountId: string,
  userAccountId: string,
  rawInput: unknown,
  ownRole: boolean,
) {
  const parsed = z.object({ roleId: z.uuid() }).safeParse(rawInput);
  if (!parsed.success || !z.uuid().safeParse(userAccountId).success) {
    throw new ValidationError({ roleId: 'Choose a role.' });
  }
  const staffRoleIds = await getStaffAccountRoleIds(db);
  if (!(await offeredRoleIds(db)).includes(parsed.data.roleId)) {
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
    if (!ownRole && userAccountId === actorUserAccountId && parsed.data.roleId !== (await getAdminAccountRoleId(tx))) {
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
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: { system_role_id: account.systemRoleId },
    });
    return { userAccountId, roleId: parsed.data.roleId };
  });
}

const addStaffSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter their name.').max(200),
  email: z.email('Enter their work email.').trim().toLowerCase(),
  roleId: z.uuid('Choose a role.'),
});

// An administrator adds a staff account before its first sign-in; signing in with this email from an
// allowed domain gives them this account and role.
export async function addStaffAccount(db: Database, adminUserAccountId: string, rawInput: unknown) {
  const parsed = addStaffSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName, email, roleId } = parsed.data;
  if (!(await offeredRoleIds(db)).includes(roleId)) {
    throw new ValidationError({ roleId: 'Choose a staff role.' });
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: userAccount.userAccountId }).from(userAccount).where(sql`lower(${userAccount.email}) = ${email}`);
    if (existing) {
      throw new ValidationError({ email: 'Someone with this email already has an account.' });
    }
    const created = firstRow(
      await tx.insert(userAccount).values({ displayName, email, active: true, systemRoleId: roleId }).returning(),
    );
    await tx.insert(auditEvent).values({
      entityType: 'user_account',
      entityId: created.userAccountId,
      eventType: 'staff_account_added',
      actorUserAccountId: adminUserAccountId,
      occurredAt: new Date(),
    });
    return { userAccountId: created.userAccountId };
  });
}

// An administrator deactivates another staff account, which can't sign in or act but keeps its history, or
// restores it.
export async function setStaffActive(db: Database, adminUserAccountId: string, userAccountId: string, rawInput: unknown) {
  const parsed = z.object({ active: z.boolean() }).safeParse(rawInput);
  if (!parsed.success || !z.uuid().safeParse(userAccountId).success) {
    throw new ValidationError({ active: 'Choose active or deactivated.' });
  }
  if (userAccountId === adminUserAccountId && !parsed.data.active) {
    throw new ValidationError({ active: 'Ask another administrator to deactivate your account.' });
  }
  const staffRoleIds = await getStaffAccountRoleIds(db);
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ systemRoleId: userAccount.systemRoleId, active: userAccount.active })
      .from(userAccount)
      .where(eq(userAccount.userAccountId, userAccountId))
      .for('update');
    if (!account?.systemRoleId || !staffRoleIds.includes(account.systemRoleId)) {
      throw new NotFoundError('Staff account not found.');
    }
    if (account.active !== parsed.data.active) {
      await tx.update(userAccount).set({ active: parsed.data.active }).where(eq(userAccount.userAccountId, userAccountId));
      await tx.insert(auditEvent).values({
        entityType: 'user_account',
        entityId: userAccountId,
        eventType: parsed.data.active ? 'staff_account_reactivated' : 'staff_account_deactivated',
        actorUserAccountId: adminUserAccountId,
        occurredAt: new Date(),
        priorValues: { active: account.active },
      });
    }
    return { userAccountId, active: parsed.data.active };
  });
}

// Every staff account, deactivated ones too, for Settings; a retired role shows as Staff.
export async function listStaffAccounts(db: DatabaseOrTransaction) {
  const [rows, staffRoleId] = await Promise.all([
    db
      .select({
        userAccountId: userAccount.userAccountId,
        displayName: userAccount.displayName,
        email: userAccount.email,
        active: userAccount.active,
        roleId: userAccount.systemRoleId,
        roleName: role.displayName,
      })
      .from(userAccount)
      .innerJoin(role, eq(userAccount.systemRoleId, role.roleId))
      .where(inArray(userAccount.systemRoleId, await getStaffAccountRoleIds(db)))
      .orderBy(desc(userAccount.active), asc(userAccount.displayName)),
    getStaffAccountRoleId(db),
  ]);
  return rows.map(({ roleName, ...row }) => ({ ...row, roleId: RETIRED_STAFF_ROLE_DISPLAY_NAMES.includes(roleName) ? staffRoleId : row.roleId }));
}

// The roles an administrator may give: Staff and Administrator.
export async function listStaffRoles(db: DatabaseOrTransaction) {
  const rows = await db
    .select({ roleId: role.roleId, displayName: role.displayName })
    .from(role)
    .where(and(inArray(role.displayName, OFFERED_STAFF_ROLE_DISPLAY_NAMES), eq(role.roleContext, 'user_account')));
  return OFFERED_STAFF_ROLE_DISPLAY_NAMES.flatMap((name) => rows.filter((row) => row.displayName === name));
}

async function offeredRoleIds(db: DatabaseOrTransaction): Promise<string[]> {
  return (await listStaffRoles(db)).map((row) => row.roleId);
}
