// Prices time and mileage lines at their stated rate, else their default (./defaultRates.ts), recording where
// each default came from, and refreshes the total. A linked time entry's date and hours govern.
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { expenseTypes, invoice, invoiceLine, invoiceLineTypes, timeEntry } from '../db/schema';
import { ValidationError } from '../errors';
import { professionalRateLabels } from './professionalRates';
import { loadDefaultRates, rateTypeOf, type DefaultRate } from './defaultRates';
import { fromCents, toCents } from './money';

export interface PriceOptions {
  // Null until staff choose the professional of an invoice in intake.
  billedProfessionalId: string | null;
  // A line with no timekeeper is the billed professional's work, except on
  // an unconfirmed import, where it is not matched yet.
  unmatchedMeansBilled: boolean;
  // On at confirmation and submission. Off when saving a draft: a line that
  // can't be priced yet keeps its stated amount, or zero.
  strict: boolean;
}

export async function priceLines(tx: Transaction, invoiceId: string, options: PriceOptions): Promise<string> {
  const lines = await tx
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      expenseTypeCode: expenseTypes.code,
      amount: invoiceLine.amount,
      serviceDate: invoiceLine.serviceDate,
      quantity: invoiceLine.quantity,
      unitRate: invoiceLine.unitRate,
      description: invoiceLine.description,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      tripId: invoiceLine.tripId,
      timeCategory: invoiceLine.timeCategory,
      entryProfessionalId: timeEntry.professionalId,
      entryDate: timeEntry.activityOn,
      entryHours: timeEntry.durationHours,
    })
    .from(invoiceLine)
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
    .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
    .where(eq(invoiceLine.invoiceId, invoiceId));

  const priced = lines.map((line) => {
    if (line.lineTypeCode !== 'time') {
      return { ...line, professionalId: undefined, date: undefined, hours: undefined };
    }
    const professionalId =
      line.entryProfessionalId ??
      line.timekeeperProfessionalId ??
      (options.unmatchedMeansBilled ? options.billedProfessionalId : undefined);
    return {
      ...line,
      professionalId: professionalId ?? undefined,
      date: line.entryDate ?? line.serviceDate ?? undefined,
      hours: line.entryHours ?? line.quantity ?? undefined,
    };
  });
  const professionalIds = [...new Set(priced.flatMap((line) => (line.professionalId ? [line.professionalId] : [])))];
  const [header] = await tx.select({ caseId: invoice.caseId }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
  const [{ resolve }, labels] = await Promise.all([
    loadDefaultRates(tx, header?.caseId ?? null, [...professionalIds, ...(options.billedProfessionalId ? [options.billedProfessionalId] : [])]),
    professionalRateLabels(tx, professionalIds),
  ]);
  const missingRate = (professionalId: string, date: string) => {
    const label = labels.get(professionalId);
    return label?.kind
      ? `No ${label.kind} rate is set for ${date}, so ${label.name}'s time can't be priced. Ask an administrator to set one.`
      : `${label?.name ?? 'This professional'} has no professional kind, so their time can't be priced. Ask an administrator to set one.`;
  };
  // The default is kept so review can flag a rate that differs from it.
  const setPrice = (invoiceLineId: string, cents: number, rate: string, byDefault: DefaultRate, changes: { serviceDate?: string; quantity?: string } = {}) =>
    tx
      .update(invoiceLine)
      .set({
        amount: fromCents(cents),
        billedRate: rate,
        configuredRate: byDefault.rate,
        rateSource: byDefault.source,
        caseRateId: byDefault.caseRateId,
        ...changes,
      })
      .where(and(eq(invoiceLine.invoiceLineId, invoiceLineId), eq(invoiceLine.invoiceId, invoiceId)));

  let totalCents = 0;
  for (const line of priced) {
    if (line.expenseTypeCode === 'mileage') {
      const miles = Number(line.quantity ?? 0);
      const byDefault = line.serviceDate ? resolve(options.billedProfessionalId, 'mileage', line.serviceDate) : undefined;
      if (!line.serviceDate || miles <= 0 || byDefault === undefined) {
        if (options.strict) {
          const item = line.description ? `The mileage "${line.description}"` : 'A mileage item';
          throw new ValidationError({
            lines:
              !line.serviceDate || miles <= 0
                ? `${item} needs ${!line.serviceDate && miles <= 0 ? 'a date and miles' : !line.serviceDate ? 'a date' : 'miles'}.`
                : `No mileage rate is set for ${line.serviceDate}, so mileage can't be priced. Ask an administrator to set one.`,
          });
        }
        totalCents += toCents(line.amount);
        continue;
      }
      const cents = Math.round(miles * Number(byDefault.rate) * 100);
      totalCents += cents;
      // eslint-disable-next-line no-await-in-loop
      await setPrice(line.invoiceLineId, cents, byDefault.rate, byDefault);
      continue;
    }
    if (line.lineTypeCode !== 'time') {
      totalCents += toCents(line.amount);
      continue;
    }
    const rateType = rateTypeOf(line)!;
    const byDefault = line.professionalId && line.date ? resolve(line.professionalId, rateType, line.date) : undefined;
    const hours = line.hours === undefined ? 0 : Number(line.hours);
    if (!line.professionalId || !line.date || hours <= 0 || byDefault === undefined) {
      if (options.strict) {
        const item = line.description ? `The time item "${line.description}"` : rateType !== 'hourly' ? `A ${rateType} time item` : 'A time item';
        const missing = !line.date && hours <= 0 ? 'a date and hours' : !line.date ? 'a date' : 'hours';
        throw new ValidationError({
          lines: !line.professionalId
            ? 'Choose who did the work for each time item.'
            : !line.date || hours <= 0
              ? `${item} needs ${missing}.`
              : missingRate(line.professionalId, line.date),
        });
      }
      totalCents += toCents(line.amount);
      continue;
    }
    // A rate stated on the supporting invoice is what was requested.
    const billedRate = line.unitRate !== null && Number(line.unitRate) > 0 ? line.unitRate : byDefault.rate;
    const cents = Math.round(hours * Number(billedRate) * 100);
    totalCents += cents;
    // eslint-disable-next-line no-await-in-loop
    await setPrice(line.invoiceLineId, cents, billedRate, byDefault, { serviceDate: line.date, quantity: String(hours) });
  }
  const total = fromCents(totalCents);
  await tx.update(invoice).set({ submittedTotal: total }).where(eq(invoice.invoiceId, invoiceId));
  return total;
}
