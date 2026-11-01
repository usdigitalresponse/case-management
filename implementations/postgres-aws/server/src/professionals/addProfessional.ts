// Staff add someone who hasn't signed in (model/rules.yaml
// add_professional_without_login); signing in later with the same email
// links them (./ensureProfessional.ts). Probable duplicates are refused,
// never merged.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { auditEvent, person, professional, professionalKinds } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { emailInUse, optionalEmail } from '../people/emails';
import { addOwnRates } from '../billing/professionalRates';

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => value || undefined);

export const personDetailsSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter their name.').max(200),
  email: optionalEmail,
  phone: optionalText,
  paidThrough: optionalText,
  hourlyRate: z.coerce.number().positive('Enter an hourly rate above zero.').max(100000).optional(),
  ratePerMile: z.coerce.number().positive('Enter a mileage rate above zero.').max(100).optional(),
});

const inputSchema = personDetailsSchema.extend({ professionalKindId: z.uuid('Choose what kind of provider they are.') });

export async function addProfessional(db: Database, actorUserAccountId: string, rawInput: unknown) {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName, email, professionalKindId, phone, paidThrough, hourlyRate, ratePerMile } = parsed.data;
  const [kind] = await db.select({ id: professionalKinds.id }).from(professionalKinds).where(eq(professionalKinds.id, professionalKindId));
  if (!kind) {
    throw new ValidationError({ professionalKindId: 'Choose what kind of provider they are.' });
  }
  if (email && (await emailInUse(db, email, 'professionals'))) {
    throw new ValidationError({ email: 'Someone with this email is already in the system. Find them in the list instead.' });
  }
  return db.transaction(async (tx) => {
    const personRow = firstRow(await tx.insert(person).values({ displayName, email }).returning());
    const row = firstRow(
      await tx
        .insert(professional)
        .values({ personId: personRow.personId, displayName, professionalKindId, active: true, phone, paidThrough })
        .returning(),
    );
    // A new person's first rates cover all their work, however far back.
    if (hourlyRate !== undefined || ratePerMile !== undefined) {
      await addOwnRates(tx, actorUserAccountId, row.professionalId, { hourlyRate, ratePerMile, effectiveFrom: '2000-01-01' });
    }
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
