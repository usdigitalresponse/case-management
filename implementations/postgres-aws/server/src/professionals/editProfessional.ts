// Administrators correct a provider's name, or add or fix the email of one
// added without it (model/rules.yaml add_professional_without_login). Someone
// who has signed in uses their account's email, so theirs isn't changed here.
// The values replaced are kept in the audit history.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditEvent, person, professional } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { emailInUse, optionalEmail } from '../people/emails';

const inputSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter their name.').max(200),
  email: optionalEmail,
});

export async function editProfessional(db: Database, actorUserAccountId: string, professionalId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(professionalId).success) {
    throw new NotFoundError('No such provider.');
  }
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName, email } = parsed.data;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        displayName: professional.displayName,
        userAccountId: professional.userAccountId,
        personId: person.personId,
        email: person.email,
      })
      .from(professional)
      .innerJoin(person, eq(professional.personId, person.personId))
      .where(eq(professional.professionalId, professionalId))
      .for('update', { of: professional });
    if (!row) {
      throw new NotFoundError('No such provider.');
    }
    const emailChanged = (email ?? null) !== (row.email?.toLowerCase() ?? null);
    if (emailChanged && row.userAccountId) {
      throw new ValidationError({ email: 'They sign in with their email, so it can’t be changed here.' });
    }
    if (emailChanged && email && (await emailInUse(tx, email, 'professionals', row.personId))) {
      throw new ValidationError({ email: 'Someone with this email is already in the system.' });
    }
    await tx.update(professional).set({ displayName }).where(eq(professional.professionalId, professionalId));
    await tx
      .update(person)
      .set({ displayName, ...(emailChanged && { email: email ?? null }) })
      .where(eq(person.personId, row.personId));
    await tx.insert(auditEvent).values({
      entityType: 'professional',
      entityId: professionalId,
      eventType: 'professional_changed',
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: { displayName: row.displayName, email: row.email },
    });
    return { professionalId, displayName, email: emailChanged ? (email ?? null) : row.email };
  });
}
