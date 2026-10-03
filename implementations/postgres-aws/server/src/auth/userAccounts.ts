// Shared find-or-create for user_account, used by every login path
// (magic-link verify in ../routes/auth.ts, the SSO verify callback in
// ./oidcProviders.ts) — real accounts are created on first login,
// matched by email, never seeded with real addresses (../../MAPPING.md).
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { userAccount } from '../db/schema';
import { firstRow } from '../db/rowHelpers';

export async function ensureUserAccountForEmail(
  db: Database,
  email: string,
  displayName: string = email,
  // Set only when creating a brand-new account, never touched on an
  // existing one — lets a caller (the SSO verify callback) mark who it
  // created as staff without a separate update statement.
  systemRoleId?: string,
): Promise<typeof userAccount.$inferSelect> {
  const [existing] = await db.select().from(userAccount).where(eq(userAccount.email, email));
  return (
    existing ??
    firstRow(await db.insert(userAccount).values({ displayName, email, active: true, systemRoleId }).returning())
  );
}
