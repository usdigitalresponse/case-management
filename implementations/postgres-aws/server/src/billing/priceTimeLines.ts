// Prices an invoice's time lines from configured rates (model/rules.yaml
// apply_professional_rates) and refreshes its total. A linked time entry's
// date and hours govern; before one exists, the line's own.
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invoice, invoiceLine, invoiceLineTypes, timeEntry } from '../db/schema';
import { ValidationError } from '../errors';
import { listRates, professionalRateLabels, rateOn } from './professionalRates';

export interface PriceOptions {
  billedProfessionalId: string;
  // A line with no timekeeper is the billed professional's work, except on
  // an unconfirmed import, where it is not matched yet.
  unmatchedMeansBilled: boolean;
  // On at confirmation and submission. Off when saving a draft: a line that
  // can't be priced yet keeps its stated amount, or zero.
  strict: boolean;
}

export async function priceTimeLines(tx: Transaction, invoiceId: string, options: PriceOptions): Promise<string> {
  const lines = await tx
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      amount: invoiceLine.amount,
      serviceDate: invoiceLine.serviceDate,
      quantity: invoiceLine.quantity,
      description: invoiceLine.description,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      entryProfessionalId: timeEntry.professionalId,
      entryDate: timeEntry.activityOn,
      entryHours: timeEntry.durationHours,
    })
    .from(invoiceLine)
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
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
  const rates = await listRates(tx, professionalIds);
  const labels = await professionalRateLabels(tx, professionalIds);
  const missingRate = (professionalId: string, date: string) => {
    const label = labels.get(professionalId);
    return label?.kind
      ? `No ${label.kind} rate is set for ${date}, so ${label.name}'s time can't be priced. Ask an administrator to set one.`
      : `${label?.name ?? 'This professional'} has no professional kind, so their time can't be priced. Ask an administrator to set one.`;
  };

  let totalCents = 0;
  for (const line of priced) {
    if (line.lineTypeCode !== 'time') {
      totalCents += Math.round(Number(line.amount) * 100);
      continue;
    }
    const rate = line.professionalId && line.date ? rateOn(rates, line.professionalId, line.date) : undefined;
    const hours = line.hours === undefined ? 0 : Number(line.hours);
    if (!line.professionalId || !line.date || hours <= 0 || rate === undefined) {
      if (options.strict) {
        const item = line.description ? `The time item "${line.description}"` : 'A time item';
        const missing = !line.date && hours <= 0 ? 'a date and hours' : !line.date ? 'a date' : 'hours';
        throw new ValidationError({
          lines: !line.professionalId
            ? 'Choose who did the work for each time item.'
            : !line.date || hours <= 0
              ? `${item} needs ${missing}.`
              : missingRate(line.professionalId, line.date),
        });
      }
      totalCents += Math.round(Number(line.amount) * 100);
      continue;
    }
    const cents = Math.round(hours * Number(rate) * 100);
    totalCents += cents;
    // eslint-disable-next-line no-await-in-loop
    await tx
      .update(invoiceLine)
      .set({
        amount: (cents / 100).toFixed(2),
        billedRate: rate,
        serviceDate: line.date,
        quantity: String(hours),
      })
      .where(and(eq(invoiceLine.invoiceLineId, line.invoiceLineId), eq(invoiceLine.invoiceId, invoiceId)));
  }
  const total = (totalCents / 100).toFixed(2);
  await tx.update(invoice).set({ submittedTotal: total }).where(eq(invoice.invoiceId, invoiceId));
  return total;
}
