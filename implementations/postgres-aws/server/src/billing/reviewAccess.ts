// Who may do what in invoice review, from each account's system role
// (model/rules.yaml authorize_invoice_review; ../auth/staffAccountRole.ts).
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { role, userAccount } from '../db/schema';
import { ForbiddenError } from '../errors';
import { reviewPermissionsForRole, type ReviewPermissions } from '../auth/staffAccountRole';

export async function loadReviewPermissions(db: DatabaseOrTransaction, userAccountId: string): Promise<ReviewPermissions> {
  const [row] = await db
    .select({ roleName: role.displayName })
    .from(userAccount)
    .leftJoin(role, eq(userAccount.systemRoleId, role.roleId))
    .where(and(eq(userAccount.userAccountId, userAccountId), eq(userAccount.active, true)));
  return reviewPermissionsForRole(row?.roleName);
}

export async function requireReviewPermission(
  db: DatabaseOrTransaction,
  userAccountId: string,
  permission: keyof ReviewPermissions,
): Promise<void> {
  if (!(await loadReviewPermissions(db, userAccountId))[permission]) {
    const messages: Record<keyof ReviewPermissions, string> = {
      reviewLines: 'Only billing reviewers can decide invoice lines.',
      signOff: 'Only sign-off approvers can sign off invoices.',
      reassign: 'Only reviewers and approvers can change who has an invoice.',
      changeSettings: 'Only an administrator can change settings.',
    };
    throw new ForbiddenError('forbidden', messages[permission]);
  }
}

// Active staff accounts with their review permissions, for pickers.
export async function listReviewPeople(db: DatabaseOrTransaction, userAccountIds?: string[]) {
  const rows = await db
    .select({ userAccountId: userAccount.userAccountId, displayName: userAccount.displayName, roleName: role.displayName })
    .from(userAccount)
    .innerJoin(role, eq(userAccount.systemRoleId, role.roleId))
    .where(
      and(
        eq(userAccount.active, true),
        eq(role.roleContext, 'user_account'),
        ...(userAccountIds ? [inArray(userAccount.userAccountId, userAccountIds)] : []),
      ),
    );
  return rows
    .map((row) => ({ ...row, permissions: reviewPermissionsForRole(row.roleName) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
