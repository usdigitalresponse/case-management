// Bootstraps a professional profile for a user_account on first use, the
// same way oidcProviders.ts bootstraps the user_account itself — so
// there's something case_assignment can point at without a separate
// "create professional" form. Called both at email-code login (every
// external vendor gets one immediately, ../routes/auth.ts) and lazily,
// the first time a staff user is assigned to a case
// (../routes/cases.ts POST /:id/staff-assignments) — staff otherwise has
// no reason to need one.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { person, professional, PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT, userAccount } from '../db/schema';
import { firstRow, uniqueViolationConstraint } from '../db/rowHelpers';

// Read-only lookup, used wherever a route needs "the current session's
// professional, if any" without creating one (../routes/myCases.ts,
// ../routes/portal.ts) — unlike ensureProfessionalForUserAccount below,
// which only the email-code verify route should call.
export async function getProfessionalIdForUserAccount(
  db: DatabaseOrTransaction,
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

  // Staff may have added them before they signed in (./addProfessional.ts):
  // the same email takes over that profile.
  const [account] = await db.select({ email: userAccount.email }).from(userAccount).where(eq(userAccount.userAccountId, userAccountId));
  if (account?.email) {
    const [added] = await db
      .select({ professionalId: professional.professionalId })
      .from(professional)
      .innerJoin(person, eq(professional.personId, person.personId))
      .where(and(isNull(professional.userAccountId), sql`lower(${person.email}) = ${account.email.toLowerCase()}`));
    if (added) {
      await db.update(professional).set({ userAccountId }).where(eq(professional.professionalId, added.professionalId));
      return added.professionalId;
    }
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
    // account (e.g. two emailed codes verified within the same
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
