// The case_assignment-context role used when a full user assigns an
// external (magic-link) professional to a case. Provisioned the same way
// in every environment by ../db/ensureReferenceData.ts (run at migrate
// time) — this is a plain lookup, not a lazy create-on-first-use, so
// there's one provisioning mechanism for this row instead of two.
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { role } from '../db/schema';

export const EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME = 'External Submitter';

export async function getExternalSubmitterRoleId(db: Database): Promise<string> {
  const [existing] = await db
    .select({ roleId: role.roleId })
    .from(role)
    .where(and(eq(role.displayName, EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME), eq(role.roleContext, 'case_assignment')));
  if (!existing) {
    throw new Error(
      `Missing required seeded role "${EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME}" (role_context case_assignment) — ensureReferenceData should have created it at migrate time.`,
    );
  }
  return existing.roleId;
}
