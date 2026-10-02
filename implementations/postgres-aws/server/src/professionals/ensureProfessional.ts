// Bootstraps a professional profile for an external (magic-link)
// user_account on first login, the same way oidcProviders.ts bootstraps
// the user_account itself — so there's something case_assignment can point
// at without a separate "create professional" form. Only called from the
// magic-link flow (../routes/auth.ts): staff (SSO-login) professional
// profiles are a separate, not-yet-built decision (see ../../MAPPING.md).
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { person, professional, PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT } from '../db/schema';
import { firstRow, uniqueViolationConstraint } from '../db/rowHelpers';

// Read-only lookup, used wherever a route needs "the current session's
// professional, if any" without creating one (../routes/myCases.ts,
// ../routes/portal.ts) — unlike ensureProfessionalForUserAccount below,
// which only the magic-link verify route should call.
export async function getProfessionalIdForUserAccount(
  db: Database,
  userAccountId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ professionalId: professional.professionalId })
    .from(professional)
    .where(eq(professional.userAccountId, userAccountId));
  return row?.professionalId;
}

export async function ensureProfessionalForUserAccount(
  db: Database,
  userAccountId: string,
  displayName: string,
): Promise<string> {
  const [existing] = await db
    .select({ professionalId: professional.professionalId })
    .from(professional)
    .where(eq(professional.userAccountId, userAccountId));
  if (existing) {
    return existing.professionalId;
  }

  try {
    const personRow = firstRow(await db.insert(person).values({ displayName }).returning());
    const professionalRow = firstRow(
      await db
        .insert(professional)
        .values({ userAccountId, personId: personRow.personId, displayName, active: true })
        .returning(),
    );
    return professionalRow.professionalId;
  } catch (error) {
    // Lost the race to a concurrent first-login bootstrap for the same
    // account (e.g. two magic-link emails verified within the same
    // second) — the unique index on professional.user_account_id caught
    // it; recover the winner instead of leaving two professional rows.
    if (uniqueViolationConstraint(error) === PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT) {
      const professionalId = await getProfessionalIdForUserAccount(db, userAccountId);
      if (professionalId) {
        return professionalId;
      }
    }
    throw error;
  }
}
