// Looks up a role row that ./ensureReferenceData.ts provisions at migrate
// time in every environment — a plain lookup, not a lazy create-on-first-use,
// so there's one provisioning mechanism per row instead of two.
import { and, eq } from 'drizzle-orm';
import type { Database } from './client';
import { role } from './schema';

export async function getSeededRoleId(
  db: Database,
  displayName: string,
  roleContext: string,
): Promise<string> {
  const [existing] = await db
    .select({ roleId: role.roleId })
    .from(role)
    .where(and(eq(role.displayName, displayName), eq(role.roleContext, roleContext)));
  if (!existing) {
    throw new Error(
      `Missing required seeded role "${displayName}" (role_context ${roleContext}) — ensureReferenceData should have created it at migrate time.`,
    );
  }
  return existing.roleId;
}
