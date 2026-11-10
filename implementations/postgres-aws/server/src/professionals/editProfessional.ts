// Administrators change a provider's details, and their approved rates from
// today. Someone who has signed in keeps their account's email. Replaced
// values are audited; earlier rates stay for earlier work.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditEvent, person, professional, professionalKinds } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { emailInUse } from '../people/emails';
import { addOwnRates, listOwnMileageRates, listOwnTravelRates, listRates, rateOn } from '../billing/professionalRates';
import { mileageRateOn } from '../billing/mileageRates';
import { personDetailsSchema } from './addProfessional';

// Unset, their role stays.
const inputSchema = personDetailsSchema.extend({ professionalKindId: z.uuid('Choose their role.').optional() });

export async function editProfessional(db: Database, actorUserAccountId: string, professionalId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(professionalId).success) {
    throw new NotFoundError('No such provider.');
  }
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName, email, professionalKindId, phone, paidThrough, hourlyRate, ratePerMile, travelHourlyRate } = parsed.data;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        displayName: professional.displayName,
        userAccountId: professional.userAccountId,
        professionalKindId: professional.professionalKindId,
        phone: professional.phone,
        paidThrough: professional.paidThrough,
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
    if (professionalKindId) {
      const [kind] = await tx.select({ id: professionalKinds.id }).from(professionalKinds).where(eq(professionalKinds.id, professionalKindId));
      if (!kind) {
        throw new ValidationError({ professionalKindId: 'Choose their role.' });
      }
    }
    await tx
      .update(professional)
      .set({
        displayName,
        phone: phone ?? null,
        paidThrough: paidThrough ?? null,
        ...(professionalKindId && { professionalKindId }),
      })
      .where(eq(professional.professionalId, professionalId));
    await tx
      .update(person)
      .set({ displayName, ...(emailChanged && { email: email ?? null }) })
      .where(eq(person.personId, row.personId));

    // Only a rate that differs from today's starts a new one.
    const today = new Date().toISOString().slice(0, 10);
    const currentHourly = rateOn(await listRates(tx, [professionalId]), professionalId, today);
    const currentMileage = mileageRateOn((await listOwnMileageRates(tx, [professionalId])).get(professionalId) ?? [], today);
    const newHourly = hourlyRate !== undefined && Number(currentHourly) !== hourlyRate ? hourlyRate : undefined;
    const newMileage = ratePerMile !== undefined && Number(currentMileage) !== ratePerMile ? ratePerMile : undefined;
    const currentTravel = rateOn((await listOwnTravelRates(tx, [professionalId])).get(professionalId) ?? [], professionalId, today);
    const newTravel = travelHourlyRate !== undefined && Number(currentTravel) !== travelHourlyRate ? travelHourlyRate : undefined;
    if (newHourly !== undefined || newMileage !== undefined || newTravel !== undefined) {
      await addOwnRates(tx, actorUserAccountId, professionalId, {
        hourlyRate: newHourly,
        ratePerMile: newMileage,
        travelHourlyRate: newTravel,
        effectiveFrom: today,
      });
    }

    await tx.insert(auditEvent).values({
      entityType: 'professional',
      entityId: professionalId,
      eventType: 'professional_changed',
      actorUserAccountId,
      occurredAt: new Date(),
      priorValues: {
        displayName: row.displayName,
        email: row.email,
        professionalKindId: row.professionalKindId,
        phone: row.phone,
        paidThrough: row.paidThrough,
        hourlyRate: newHourly !== undefined ? (currentHourly ?? null) : undefined,
        ratePerMile: newMileage !== undefined ? (currentMileage ?? null) : undefined,
        travelHourlyRate: newTravel !== undefined ? (currentTravel ?? null) : undefined,
      },
    });
    return { professionalId, displayName, email: emailChanged ? (email ?? null) : row.email };
  });
}
