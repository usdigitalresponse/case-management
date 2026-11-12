// Shared find-or-create for user_account, used by every login path
// (email-code verify in ../routes/auth.ts, the SSO verify callback in
// ./oidcProviders.ts) — real accounts are created on first login,
// matched by email, never seeded with real addresses (../../MAPPING.md).
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { userAccount } from '../db/schema';
import { firstRow } from '../db/rowHelpers';
import { normalizeEmail } from './emailLists';

export async function ensureUserAccountForEmail(
  db: Database,
  email: string,
  displayName?: string,
  // Fills in an account's systemRoleId when it has none (a new account, or
  // a vendor account now signing in via SSO), but never replaces a role an
  // account already has.
  systemRoleId?: string,
): Promise<typeof userAccount.$inferSelect> {
  const normalizedEmail = normalizeEmail(email);
  // A single upsert rather than select-then-insert, so two simultaneous
  // first logins can't both try to insert the same email.
  return firstRow(
    await db
      .insert(userAccount)
      .values({ displayName: displayName ?? normalizedEmail, email: normalizedEmail, active: true, systemRoleId })
      .onConflictDoUpdate({
        target: userAccount.email,
        set: { systemRoleId: sql`coalesce(${userAccount.systemRoleId}, excluded.system_role_id)` },
      })
      .returning(),
  );
}

// The person an account signs in as, through which delegation and sign-in are read; set once, then moved only by a merge.
export async function linkAccountToPerson(db: DatabaseOrTransaction, userAccountId: string, personId: string): Promise<void> {
  await db.update(userAccount).set({ personId }).where(and(eq(userAccount.userAccountId, userAccountId), isNull(userAccount.personId)));
}
