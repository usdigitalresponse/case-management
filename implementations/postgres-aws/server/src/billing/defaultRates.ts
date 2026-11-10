// A line's default rate (model/rules.yaml apply_professional_rates): the
// case's rate for the person, else for their kind, else the person's own
// configured rate, else their kind's. Travel time with no case rate takes
// the person's own travel time rate; then travel and waiting time take their
// category's rate from that hourly default. Mileage with no case rate takes
// the person's own rate per mile, else the general one.
import { asc, eq, inArray } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseRate, professional } from '../db/schema';
import { listOwnMileageRates, listOwnTravelRates, listRates, rateRowOn } from './professionalRates';
import { listMileageRates, mileageRateOn } from './mileageRates';
import { categoryRateOn, categorySettingOn, listTimeCategoryRates } from './timeCategoryRates';

export const RATE_TYPES = ['hourly', 'travel', 'waiting', 'mileage'] as const;
export type RateType = (typeof RATE_TYPES)[number];
export type RateSource = 'case_person' | 'case_kind' | 'person' | 'kind' | 'general';

export interface DefaultRate {
  rate: string;
  source: RateSource;
  caseRateId: string | null;
}

export interface CaseRateRow {
  caseRateId: string;
  professionalId: string | null;
  professionalKindId: string | null;
  rateType: string;
  rate: string | null;
  effectiveFrom: string;
}

export function rateTypeOf(line: {
  lineTypeCode: string | null;
  expenseTypeCode: string | null;
  tripId: string | null;
  timeCategory: string | null;
}): RateType | null {
  if (line.expenseTypeCode === 'mileage') return 'mileage';
  if (line.lineTypeCode !== 'time') return null;
  return line.tripId ? 'travel' : line.timeCategory === 'waiting' ? 'waiting' : 'hourly';
}

// Oldest first; a later row for the same date replaces an earlier one, as recorded.
export async function listCaseRates(db: DatabaseOrTransaction, caseId: string | null): Promise<CaseRateRow[]> {
  if (!caseId) return [];
  return db
    .select({
      caseRateId: caseRate.caseRateId,
      professionalId: caseRate.professionalId,
      professionalKindId: caseRate.professionalKindId,
      rateType: caseRate.rateType,
      rate: caseRate.rate,
      effectiveFrom: caseRate.effectiveFrom,
    })
    .from(caseRate)
    .where(eq(caseRate.caseId, caseId))
    .orderBy(asc(caseRate.effectiveFrom), asc(caseRate.recordedAt));
}

export type CaseRateTarget = { professionalId: string } | { professionalKindId: string };

// The row in force for this target on a date; one with no rate returns to the configured rate.
export function caseRateOn(rows: CaseRateRow[], target: CaseRateTarget, rateType: RateType, date: string): CaseRateRow | undefined {
  const found = caseRateRowOn(rows, target, rateType, date);
  return found?.rate === null ? undefined : found;
}

// The latest row on or before the date, including one with no rate.
export function caseRateRowOn(rows: CaseRateRow[], target: CaseRateTarget, rateType: RateType, date: string): CaseRateRow | undefined {
  let found: CaseRateRow | undefined;
  for (const row of rows) {
    const matches =
      'professionalId' in target ? row.professionalId === target.professionalId : row.professionalKindId === target.professionalKindId;
    if (matches && row.rateType === rateType && row.effectiveFrom <= date) {
      found = row;
    }
  }
  return found;
}

export type DefaultRateResolver = (professionalId: string | null, rateType: RateType, date: string) => DefaultRate | undefined;

export async function loadDefaultRates(
  db: DatabaseOrTransaction,
  caseId: string | null,
  professionalIds: string[],
): Promise<{ resolve: DefaultRateResolver; kindOf: Map<string, string | null>; caseRates: CaseRateRow[] }> {
  const ids = [...new Set(professionalIds)];
  const [caseRates, hourly, ownTravel, categories, ownMileage, generalMileage, kinds] = await Promise.all([
    listCaseRates(db, caseId),
    listRates(db, ids),
    listOwnTravelRates(db, ids),
    listTimeCategoryRates(db),
    listOwnMileageRates(db, ids),
    listMileageRates(db),
    ids.length === 0
      ? []
      : db
          .select({ professionalId: professional.professionalId, kindId: professional.professionalKindId })
          .from(professional)
          .where(inArray(professional.professionalId, ids)),
  ]);
  const kindOf = new Map(kinds.map((row) => [row.professionalId, row.kindId]));

  const fromCase = (professionalId: string | null, rateType: RateType, date: string): DefaultRate | undefined => {
    if (!professionalId) return undefined;
    const own = caseRateOn(caseRates, { professionalId }, rateType, date);
    if (own) return { rate: own.rate!, source: 'case_person', caseRateId: own.caseRateId };
    const kindId = kindOf.get(professionalId);
    const byKind = kindId ? caseRateOn(caseRates, { professionalKindId: kindId }, rateType, date) : undefined;
    return byKind ? { rate: byKind.rate!, source: 'case_kind', caseRateId: byKind.caseRateId } : undefined;
  };

  const resolve: DefaultRateResolver = (professionalId, rateType, date) => {
    const setForCase = fromCase(professionalId, rateType, date);
    if (setForCase) return setForCase;
    if (rateType === 'mileage') {
      const own = professionalId ? mileageRateOn(ownMileage.get(professionalId) ?? [], date) : undefined;
      if (own) return { rate: own, source: 'person', caseRateId: null };
      const general = mileageRateOn(generalMileage, date);
      return general ? { rate: general, source: 'general', caseRateId: null } : undefined;
    }
    if (rateType === 'hourly') {
      const row = professionalId ? rateRowOn(hourly, professionalId, date) : undefined;
      return row ? { rate: row.hourlyRate, source: row.source, caseRateId: null } : undefined;
    }
    const travel = rateType === 'travel' && professionalId ? rateRowOn(ownTravel.get(professionalId) ?? [], professionalId, date) : undefined;
    if (travel) return { rate: travel.hourlyRate, source: 'person', caseRateId: null };
    const base = resolve(professionalId, 'hourly', date);
    const rate = categoryRateOn(categories, rateType, date, base?.rate);
    if (rate === undefined) return undefined;
    return categorySettingOn(categories, rateType, date)?.basis === 'flat_rate'
      ? { rate, source: 'general', caseRateId: null }
      : { rate, source: base!.source, caseRateId: base!.caseRateId };
  };

  return { resolve, kindOf, caseRates };
}
