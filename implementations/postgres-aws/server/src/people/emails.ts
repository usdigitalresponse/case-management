// Emails given for people being added: one rule for the input, and one check
// that refuses a probable duplicate rather than adding them again.
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { person, professional, userAccount } from '../db/schema';

export const optionalEmail = z
  .email('Enter a valid email, or leave it blank.')
  .trim()
  .toLowerCase()
  .optional()
  .or(z.literal('').transform(() => undefined));

// Held by a user account, or a person on record: any person, or only
// professionals (add_professional_without_login), other than `exceptPersonId`
// (theirs, when editing). `email` is lower case.
export async function emailInUse(
  db: DatabaseOrTransaction,
  email: string,
  people: 'any' | 'professionals',
  exceptPersonId?: string,
): Promise<boolean> {
  const [account] = await db.select({ id: userAccount.userAccountId }).from(userAccount).where(sql`lower(${userAccount.email}) = ${email}`).limit(1);
  if (account) {
    return true;
  }
  const query = db.select({ id: person.personId }).from(person);
  const [held] = await (people === 'professionals' ? query.innerJoin(professional, eq(professional.personId, person.personId)) : query)
    .where(and(sql`lower(${person.email}) = ${email}`, exceptPersonId ? ne(person.personId, exceptPersonId) : undefined))
    .limit(1);
  return Boolean(held);
}
