// Whoever added someone corrects them until anything lasting names them
// (model/rules.yaml add_professional_without_login).
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import { auditEvent, person, professional, professionalKinds } from '../db/schema';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { emailInUse } from '../people/emails';
import { nameParts, personDetailsSchema } from './addProfessional';
import { keptBecause, lockProfessional } from './removeProfessional';

async function lockNew(tx: Transaction, actorUserAccountId: string, professionalId: string) {
  const row = await lockProfessional(tx, professionalId);
  if (!row) return undefined;
  const [added] = await tx
    .select({ id: auditEvent.auditEventId })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entityId, professionalId),
        eq(auditEvent.eventType, 'professional_added'),
        eq(auditEvent.actorUserAccountId, actorUserAccountId),
      ),
    )
    .limit(1);
  const correctable = Boolean(added) && (await keptBecause(tx, row)).reasons.length === 0;
  return { row, correctable };
}

const inputSchema = personDetailsSchema
  .pick({ displayName: true, email: true })
  // Unset, their role stays.
  .extend({ professionalKindId: z.uuid('Choose their role.').optional(), ...nameParts });

// Name and email as they should now be (no email clears it), and their role if given.
export async function correctNewProfessional(db: Database, actorUserAccountId: string, professionalId: string, rawInput: unknown) {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName, professionalKindId, givenName, familyName } = parsed.data;
  const email = parsed.data.email ?? null;
  return db.transaction(async (tx) => {
    const found = await lockNew(tx, actorUserAccountId, professionalId);
    if (!found) throw new NotFoundError('No such person.');
    if (!found.correctable) {
      throw new ForbiddenError('forbidden', 'Their details can no longer be changed here. An administrator can change them under People.');
    }
    const { row } = found;
    const emailChanged = email !== (row.email?.toLowerCase() ?? null);
    const kindChanged = Boolean(professionalKindId) && professionalKindId !== row.professionalKindId;
    if (displayName === row.displayName && !emailChanged && !kindChanged) return { professionalId, displayName, email };
    if (emailChanged && email && (await emailInUse(tx, email, 'professionals', row.personId))) {
      throw new ValidationError({ email: 'Someone with this email is already in the system. Choose them from the list instead.' });
    }
    if (kindChanged) {
      const [kind] = await tx
        .select({ id: professionalKinds.id })
        .from(professionalKinds)
        .where(and(eq(professionalKinds.id, professionalKindId!), eq(professionalKinds.active, true)));
      if (!kind) throw new ValidationError({ professionalKindId: 'Choose one of the listed roles.' });
    }
    await tx
      .update(professional)
      .set({ displayName, ...(kindChanged && { professionalKindId }) })
      .where(eq(professional.professionalId, professionalId));
    await tx
      .update(person)
      .set({ displayName, email, givenName: givenName ?? null, familyName: familyName ?? null })
      .where(eq(person.personId, row.personId));
    await tx.insert(auditEvent).values({
      entityType: 'professional',
      entityId: professionalId,
      eventType: 'professional_changed',
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: { displayName: row.displayName, email: row.email, professionalKindId: row.professionalKindId },
    });
    return { professionalId, displayName, email };
  });
}
