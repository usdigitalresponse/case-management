// Administrator-set pricing of travel and waiting time (model/rules.yaml
// apply_time_category_rates). Settings are only added: the one for a category
// on a date is its latest effective on or before it; with none, that time is
// priced like work.
import { z } from 'zod';
import { asc } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { timeCategoryRate } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';

export const TIME_CATEGORIES = ['travel', 'waiting'] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];
export type TimeCategoryBasis = 'hourly_rate' | 'percent_of_hourly_rate' | 'flat_rate';

export interface TimeCategoryRateRow {
  category: TimeCategory;
  basis: TimeCategoryBasis;
  percent: string | null;
  hourlyRate: string | null;
  effectiveFrom: string;
}

// Oldest first.
export async function listTimeCategoryRates(db: DatabaseOrTransaction): Promise<TimeCategoryRateRow[]> {
  const rows = await db
    .select({
      category: timeCategoryRate.category,
      basis: timeCategoryRate.basis,
      percent: timeCategoryRate.percent,
      hourlyRate: timeCategoryRate.hourlyRate,
      effectiveFrom: timeCategoryRate.effectiveFrom,
    })
    .from(timeCategoryRate)
    .orderBy(asc(timeCategoryRate.effectiveFrom), asc(timeCategoryRate.recordedAt));
  return rows.map((row) => ({ ...row, category: row.category as TimeCategory, basis: row.basis as TimeCategoryBasis }));
}

// The rate for this category of time by someone whose hourly rate on that
// date is `hourlyRate`; undefined when it depends on an hourly rate there isn't.
export function categoryRateOn(
  settings: TimeCategoryRateRow[],
  category: TimeCategory,
  date: string,
  hourlyRate: string | undefined,
): string | undefined {
  let setting: TimeCategoryRateRow | undefined;
  for (const candidate of settings) {
    if (candidate.category === category && candidate.effectiveFrom <= date) {
      setting = candidate;
    }
  }
  if (setting?.basis === 'flat_rate') {
    return setting.hourlyRate ?? undefined;
  }
  if (hourlyRate === undefined) {
    return undefined;
  }
  if (setting?.basis === 'percent_of_hourly_rate') {
    return (Math.round(Number(hourlyRate) * Number(setting.percent)) / 100).toFixed(2);
  }
  return hourlyRate;
}

const category = z.enum(TIME_CATEGORIES);
const addSchema = z.discriminatedUnion('basis', [
  z.object({ category, basis: z.literal('hourly_rate'), effectiveFrom: z.iso.date() }),
  z.object({ category, basis: z.literal('percent_of_hourly_rate'), percent: z.coerce.number().positive().max(100), effectiveFrom: z.iso.date() }),
  z.object({ category, basis: z.literal('flat_rate'), hourlyRate: z.coerce.number().positive().max(100000), effectiveFrom: z.iso.date() }),
]);

export async function addTimeCategoryRate(
  db: DatabaseOrTransaction,
  adminUserAccountId: string,
  rawInput: unknown,
): Promise<TimeCategoryRateRow> {
  const parsed = addSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  const row = firstRow(
    await db
      .insert(timeCategoryRate)
      .values({
        category: input.category,
        basis: input.basis,
        percent: input.basis === 'percent_of_hourly_rate' ? input.percent.toFixed(2) : null,
        hourlyRate: input.basis === 'flat_rate' ? input.hourlyRate.toFixed(2) : null,
        effectiveFrom: input.effectiveFrom,
        recordedByUserAccountId: adminUserAccountId,
        recordedAt: new Date(),
      })
      .returning(),
  );
  return {
    category: row.category as TimeCategory,
    basis: row.basis as TimeCategoryBasis,
    percent: row.percent,
    hourlyRate: row.hourlyRate,
    effectiveFrom: row.effectiveFrom,
  };
}
