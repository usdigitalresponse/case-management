// Administrator-set rates per mile (model/rules.yaml apply_mileage_rates).
// Rates are only added: the rate on a date is the one with the latest
// effective_from on or before it.
import { z } from 'zod';
import { asc } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { mileageRate } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';

export interface MileageRateRow {
  ratePerMile: string;
  effectiveFrom: string;
}

// Oldest first.
export async function listMileageRates(db: DatabaseOrTransaction): Promise<MileageRateRow[]> {
  return db
    .select({ ratePerMile: mileageRate.ratePerMile, effectiveFrom: mileageRate.effectiveFrom })
    .from(mileageRate)
    .orderBy(asc(mileageRate.effectiveFrom), asc(mileageRate.recordedAt));
}

export function mileageRateOn(rates: MileageRateRow[], date: string): string | undefined {
  let found: string | undefined;
  for (const rate of rates) {
    if (rate.effectiveFrom <= date) {
      found = rate.ratePerMile;
    }
  }
  return found;
}

const addMileageRateSchema = z.object({
  ratePerMile: z.coerce.number().positive().max(100),
  effectiveFrom: z.iso.date(),
});

export async function addMileageRate(
  db: DatabaseOrTransaction,
  adminUserAccountId: string,
  rawInput: unknown,
): Promise<MileageRateRow> {
  const parsed = addMileageRateSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const row = firstRow(
    await db
      .insert(mileageRate)
      .values({
        ratePerMile: parsed.data.ratePerMile.toFixed(3),
        effectiveFrom: parsed.data.effectiveFrom,
        recordedByUserAccountId: adminUserAccountId,
        recordedAt: new Date(),
      })
      .returning(),
  );
  return { ratePerMile: row.ratePerMile, effectiveFrom: row.effectiveFrom };
}
