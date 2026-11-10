// model/rules.yaml apply_preauthorization_limit. Insert-only; the latest on or before a date is in force.
import { z } from 'zod';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { county, preauthorizationThreshold, professional, professionalKinds } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { requireReviewPermission } from './reviewAccess';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';

export interface ThresholdRow {
  countyId: string | null;
  amount: string | null;
  effectiveFrom: string;
  recordedAt: Date;
}

export type ThresholdTable = ThresholdRow[];

export async function loadThresholdTable(db: DatabaseOrTransaction, on: string = today()): Promise<ThresholdTable> {
  return db
    .select({
      countyId: preauthorizationThreshold.countyId,
      amount: preauthorizationThreshold.amount,
      effectiveFrom: preauthorizationThreshold.effectiveFrom,
      recordedAt: preauthorizationThreshold.recordedAt,
    })
    .from(preauthorizationThreshold)
    .where(lte(preauthorizationThreshold.effectiveFrom, on))
    .orderBy(desc(preauthorizationThreshold.effectiveFrom), desc(preauthorizationThreshold.recordedAt));
}

// A county's latest row wins; an empty amount there returns it to the default.
export function thresholdFrom(table: ThresholdTable, countyId: string | null): { amount: string; countyOwn: boolean } | null {
  const own = countyId ? table.find((row) => row.countyId === countyId) : undefined;
  if (own?.amount) return { amount: own.amount, countyOwn: true };
  const fallback = table.find((row) => row.countyId === null);
  return fallback?.amount ? { amount: fallback.amount, countyOwn: false } : null;
}

export async function thresholdFor(db: DatabaseOrTransaction, countyId: string | null): Promise<string | null> {
  return thresholdFrom(await loadThresholdTable(db), countyId)?.amount ?? null;
}

export async function thresholdBoundProfessionalIds(db: DatabaseOrTransaction, professionalIds: string[]): Promise<Set<string>> {
  if (professionalIds.length === 0) return new Set();
  const rows = await db
    .select({ professionalId: professional.professionalId })
    .from(professional)
    .innerJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(and(inArray(professional.professionalId, professionalIds), eq(professionalKinds.thresholdApplies, true)));
  return new Set(rows.map((row) => row.professionalId));
}

export interface ThresholdSettings {
  current: Array<{ countyId: string | null; countyName: string | null; isCounty: boolean; amount: string | null; effectiveFrom: string }>;
  history: Array<{ countyId: string | null; countyName: string | null; amount: string | null; effectiveFrom: string; recordedAt: Date; recordedBy: string | null }>;
  kinds: Array<{ professionalKindId: string; displayName: string; thresholdApplies: boolean }>;
}

export async function getThresholdSettings(db: DatabaseOrTransaction): Promise<ThresholdSettings> {
  const [rows, kinds, current] = await Promise.all([
    db
      .select({
        countyId: preauthorizationThreshold.countyId,
        countyName: county.displayName,
        isCounty: county.isCounty,
        amount: preauthorizationThreshold.amount,
        effectiveFrom: preauthorizationThreshold.effectiveFrom,
        recordedAt: preauthorizationThreshold.recordedAt,
        recordedBy: preauthorizationThreshold.recordedByUserAccountId,
      })
      .from(preauthorizationThreshold)
      .leftJoin(county, eq(preauthorizationThreshold.countyId, county.countyId))
      .orderBy(desc(preauthorizationThreshold.effectiveFrom), desc(preauthorizationThreshold.recordedAt)),
    db
      .select({ professionalKindId: professionalKinds.id, displayName: professionalKinds.displayName, thresholdApplies: professionalKinds.thresholdApplies })
      .from(professionalKinds)
      .where(eq(professionalKinds.active, true))
      .orderBy(asc(professionalKinds.displayName)),
    loadThresholdTable(db),
  ]);
  const seen = new Set<string | null>();
  const inForce: ThresholdSettings['current'] = [];
  for (const row of current) {
    if (seen.has(row.countyId)) continue;
    seen.add(row.countyId);
    const named = rows.find((other) => other.countyId === row.countyId);
    inForce.push({
      countyId: row.countyId,
      countyName: named?.countyName ?? null,
      isCounty: named?.isCounty ?? true,
      amount: row.amount,
      effectiveFrom: row.effectiveFrom,
    });
  }
  // The default first, then settings, then counties by name.
  inForce.sort((a, b) =>
    a.countyId === null ? -1 : b.countyId === null ? 1 : Number(a.isCounty) - Number(b.isCounty) || (a.countyName ?? '').localeCompare(b.countyName ?? ''),
  );
  return {
    current: inForce.filter((row) => row.countyId === null || row.amount !== null),
    history: rows.map(({ isCounty: _isCounty, ...row }) => row),
    kinds,
  };
}

const thresholdInputSchema = z.object({
  countyId: z.uuid().nullable(),
  // Null removes a county's own threshold; the default can't be removed, only replaced.
  amount: z.coerce.number().positive('Enter an amount above zero.').max(10_000_000).nullable(),
  effectiveFrom: z.iso.date('Enter the date it takes effect.'),
});

export async function addThreshold(db: DatabaseOrTransaction, actorUserAccountId: string, rawInput: unknown) {
  await requireReviewPermission(db, actorUserAccountId, 'changeSettings');
  const parsed = thresholdInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  if (input.countyId === null && input.amount === null) {
    throw new ValidationError({ amount: 'Enter the default threshold.' });
  }
  if (input.countyId) {
    const [row] = await db.select({ countyId: county.countyId }).from(county).where(eq(county.countyId, input.countyId));
    if (!row) throw new NotFoundError('County not found.');
  }
  await db.insert(preauthorizationThreshold).values({
    countyId: input.countyId,
    amount: input.amount === null ? null : input.amount.toFixed(2),
    effectiveFrom: input.effectiveFrom,
    recordedByUserAccountId: actorUserAccountId,
    recordedAt: new Date(),
  });
  return getThresholdSettings(db);
}

export async function setKindThresholdApplies(db: DatabaseOrTransaction, actorUserAccountId: string, kindId: string, rawInput: unknown) {
  await requireReviewPermission(db, actorUserAccountId, 'changeSettings');
  const parsed = z.object({ thresholdApplies: z.boolean() }).safeParse(rawInput);
  if (!parsed.success || !z.uuid().safeParse(kindId).success) {
    throw new ValidationError({ thresholdApplies: 'Choose whether thresholds apply.' });
  }
  const updated = await db
    .update(professionalKinds)
    .set({ thresholdApplies: parsed.data.thresholdApplies })
    .where(eq(professionalKinds.id, kindId))
    .returning({ id: professionalKinds.id });
  if (updated.length === 0) throw new NotFoundError('Kind not found.');
  return getThresholdSettings(db);
}

function today(): string {
  return calendarDateInReportingTimeZone(new Date());
}
