// Administrator-configured rates (model/rules.yaml apply_professional_rates):
// a vocabulary of professional kinds, each professional's kind, and each
// kind's hourly rates. Rates are only added: the rate on a date is the one
// with the latest effective_from on or before it.
import { z } from 'zod';
import { asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { professional, professionalKindRate, professionalKinds } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';

export interface RateRow {
  professionalId: string;
  hourlyRate: string;
  effectiveFrom: string;
}

// Each professional's kind's rates, oldest first.
export async function listRates(db: DatabaseOrTransaction, professionalIds: string[]): Promise<RateRow[]> {
  if (professionalIds.length === 0) {
    return [];
  }
  return db
    .select({
      professionalId: professional.professionalId,
      hourlyRate: professionalKindRate.hourlyRate,
      effectiveFrom: professionalKindRate.effectiveFrom,
    })
    .from(professional)
    .innerJoin(professionalKindRate, eq(professionalKindRate.professionalKindId, professional.professionalKindId))
    .where(inArray(professional.professionalId, professionalIds))
    .orderBy(asc(professionalKindRate.effectiveFrom), asc(professionalKindRate.recordedAt));
}

// A later row for the same date replaces an earlier one, as recorded.
export function rateOn(rates: RateRow[], professionalId: string, date: string): string | undefined {
  let found: string | undefined;
  for (const rate of rates) {
    if (rate.professionalId === professionalId && rate.effectiveFrom <= date) {
      found = rate.hourlyRate;
    }
  }
  return found;
}

// For saying which is missing when time can't be priced.
export async function professionalRateLabels(
  db: DatabaseOrTransaction,
  professionalIds: string[],
): Promise<Map<string, { name: string; kind: string | null }>> {
  if (professionalIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      professionalId: professional.professionalId,
      displayName: professional.displayName,
      kind: professionalKinds.displayName,
    })
    .from(professional)
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(inArray(professional.professionalId, professionalIds));
  return new Map(rows.map((row) => [row.professionalId, { name: row.displayName ?? 'this professional', kind: row.kind }]));
}

// --- settings ---------------------------------------------------------------

export interface KindWithRates {
  professionalKindId: string;
  displayName: string;
  active: boolean;
  rates: Array<{ hourlyRate: string; effectiveFrom: string }>;
}

export async function listKinds(db: DatabaseOrTransaction): Promise<KindWithRates[]> {
  const kinds = await db.select().from(professionalKinds).orderBy(asc(professionalKinds.displayName));
  const rates = await db
    .select()
    .from(professionalKindRate)
    .orderBy(asc(professionalKindRate.effectiveFrom), asc(professionalKindRate.recordedAt));
  return kinds.map((kind) => ({
    professionalKindId: kind.id,
    displayName: kind.displayName,
    active: kind.active,
    rates: rates
      .filter((rate) => rate.professionalKindId === kind.id)
      .map(({ hourlyRate, effectiveFrom }) => ({ hourlyRate, effectiveFrom })),
  }));
}

const kindInputSchema = z.object({ displayName: z.string().trim().min(1).max(100) });

export async function createKind(db: DatabaseOrTransaction, rawInput: unknown): Promise<KindWithRates> {
  const parsed = kindInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { displayName } = parsed.data;
  const code = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'kind';
  const [row] = await db
    .insert(professionalKinds)
    .values({ code, displayName })
    .onConflictDoNothing({ target: professionalKinds.code })
    .returning();
  if (!row) {
    throw new ConflictError('duplicate_kind', `There is already a kind called "${displayName}".`);
  }
  return { professionalKindId: row.id, displayName: row.displayName, active: row.active, rates: [] };
}

export const addRateInputSchema = z.object({
  hourlyRate: z.coerce.number().positive().max(100000),
  effectiveFrom: z.iso.date(),
});

export async function addKindRate(
  db: DatabaseOrTransaction,
  adminUserAccountId: string,
  professionalKindId: string,
  rawInput: unknown,
): Promise<{ hourlyRate: string; effectiveFrom: string }> {
  const parsed = addRateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  await requireKind(db, professionalKindId);
  const row = firstRow(
    await db
      .insert(professionalKindRate)
      .values({
        professionalKindId,
        hourlyRate: parsed.data.hourlyRate.toFixed(2),
        effectiveFrom: parsed.data.effectiveFrom,
        recordedByUserAccountId: adminUserAccountId,
        recordedAt: new Date(),
      })
      .returning(),
  );
  return { hourlyRate: row.hourlyRate, effectiveFrom: row.effectiveFrom };
}

const professionalKindInputSchema = z.object({ professionalKindId: z.uuid().nullable() });

export async function setProfessionalKind(
  db: DatabaseOrTransaction,
  professionalId: string,
  rawInput: unknown,
): Promise<{ professionalId: string; professionalKindId: string | null }> {
  const parsed = professionalKindInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { professionalKindId } = parsed.data;
  if (professionalKindId) {
    await requireKind(db, professionalKindId);
  }
  if (!z.uuid().safeParse(professionalId).success) {
    throw new NotFoundError('Professional not found.');
  }
  const [row] = await db
    .update(professional)
    .set({ professionalKindId })
    .where(eq(professional.professionalId, professionalId))
    .returning({ professionalId: professional.professionalId });
  if (!row) {
    throw new NotFoundError('Professional not found.');
  }
  return { professionalId, professionalKindId };
}

async function requireKind(db: DatabaseOrTransaction, professionalKindId: string) {
  if (!z.uuid().safeParse(professionalKindId).success) {
    throw new NotFoundError('Kind not found.');
  }
  const [kind] = await db.select({ id: professionalKinds.id }).from(professionalKinds).where(eq(professionalKinds.id, professionalKindId));
  if (!kind) {
    throw new NotFoundError('Kind not found.');
  }
}
