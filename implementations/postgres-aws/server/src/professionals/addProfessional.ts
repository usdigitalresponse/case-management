// Staff add a provider who has never signed in, from invoice intake
// (model/rules.yaml add_professional_without_login). The profile has no
// account; if the person later signs in with the same email, they get this
// profile (./ensureProfessional.ts). Probable duplicates are refused, never
// merged.
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { auditEvent, person, professional, professionalKinds, userAccount } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';

const inputSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter their name.').max(200),
  email: z.email('Enter a valid email, or leave it blank.').trim().toLowerCase().optional().or(z.literal('').transform(() => undefined)),
  professionalKindId: z.uuid('Choose what kind of provider they are.'),
});

export async function addProfessional(db: Database, actorUserAccountId: string, rawInput: unknown) {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName, email, professionalKindId } = parsed.data;
  const [kind] = await db.select({ id: professionalKinds.id }).from(professionalKinds).where(eq(professionalKinds.id, professionalKindId));
  if (!kind) {
    throw new ValidationError({ professionalKindId: 'Choose what kind of provider they are.' });
  }
  if (email) {
    const [account] = await db.select({ id: userAccount.userAccountId }).from(userAccount).where(sql`lower(${userAccount.email}) = ${email}`);
    const [added] = await db
      .select({ id: professional.professionalId })
      .from(professional)
      .innerJoin(person, eq(professional.personId, person.personId))
      .where(sql`lower(${person.email}) = ${email}`);
    if (account || added) {
      throw new ValidationError({ email: 'Someone with this email is already in the system. Find them in the list instead.' });
    }
  }
  return db.transaction(async (tx) => {
    const personRow = firstRow(await tx.insert(person).values({ displayName, email }).returning());
    const row = firstRow(
      await tx
        .insert(professional)
        .values({ personId: personRow.personId, displayName, professionalKindId, active: true })
        .returning(),
    );
    // A new record has no prior values; who added it is the point.
    await tx.insert(auditEvent).values({
      entityType: 'professional',
      entityId: row.professionalId,
      eventType: 'professional_added',
      actorUserAccountId,
      occurredAt: new Date(),
    });
    return { professionalId: row.professionalId, displayName: row.displayName };
  });
}
