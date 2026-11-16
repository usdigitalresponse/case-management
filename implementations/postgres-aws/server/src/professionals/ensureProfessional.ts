// A user account's professional profile, made at an external user's first sign-in or a staff member's first
// case assignment.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { person, professional, PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT, userAccount } from '../db/schema';
import { firstRow, uniqueViolationConstraint } from '../db/rowHelpers';
import { linkAccountToPerson } from '../auth/userAccounts';

// The account's profile, if any, without making one.
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
    .select({ professionalId: professional.professionalId, personId: professional.personId })
    .from(professional)
    .where(eq(professional.userAccountId, userAccountId));
  if (existing) {
    await linkAccountToPerson(db, userAccountId, existing.personId);
    return existing.professionalId;
  }

  // Staff may have added them before they signed in (./addProfessional.ts):
  // their person's profile, else the same email's, is taken over.
  const [account] = await db
    .select({ email: userAccount.email, personId: userAccount.personId })
    .from(userAccount)
    .where(eq(userAccount.userAccountId, userAccountId));
  if (account?.email) {
    const [added] = await db
      .select({ professionalId: professional.professionalId, personId: professional.personId })
      .from(professional)
      .innerJoin(person, eq(professional.personId, person.personId))
      .where(
        and(
          isNull(professional.userAccountId),
          isNull(person.mergedIntoPersonId),
          account.personId ? eq(person.personId, account.personId) : sql`lower(${person.email}) = ${account.email.toLowerCase()}`,
        ),
      );
    if (added) {
      await db.update(professional).set({ userAccountId }).where(eq(professional.professionalId, added.professionalId));
      await linkAccountToPerson(db, userAccountId, added.personId);
      return added.professionalId;
    }
  }

  try {
    const personId = account?.personId ?? firstRow(await db.insert(person).values({ displayName }).returning()).personId;
    const professionalRow = firstRow(
      await db
        .insert(professional)
        .values({ userAccountId, personId, displayName, active: true })
        .returning(),
    );
    await linkAccountToPerson(db, userAccountId, personId);
    return professionalRow.professionalId;
  } catch (error) {
    // A concurrent first sign-in made it first: take theirs.
    if (uniqueViolationConstraint(error) === PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT) {
      const professionalId = await getProfessionalIdForUserAccount(db, userAccountId);
      if (professionalId) {
        return professionalId;
      }
    }
    throw error;
  }
}
