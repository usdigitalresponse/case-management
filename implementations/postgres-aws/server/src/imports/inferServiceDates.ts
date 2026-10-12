// Dates for imported lines that have none, from the file's billing period
// (model/rules.yaml validate_invoice_import): the period's end, marked as
// inferred, unless the person's rate changes inside the period, they weren't
// assigned to the case for all of it, or who did the work isn't known yet.
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { caseAssignment, professional } from '../db/schema';
import { listRates } from '../billing/professionalRates';
import type { ImportWarning } from './parsedInvoice';

export const DATE_FROM_PERIOD_WARNING = 'date_from_period';

interface UndatedLine {
  location: string;
  lineType: string;
  serviceDate?: string;
  timekeeperProfessionalId?: string;
}

function formatPeriod(start: string, end: string): string {
  return `${start} to ${end}`;
}

export async function inferServiceDates(
  tx: Transaction,
  args: { caseId: string; periodStart?: string; periodEnd?: string; lines: UndatedLine[] },
): Promise<{ dates: Array<string | undefined>; warnings: ImportWarning[] }> {
  const { periodStart, periodEnd, caseId, lines } = args;
  const dates = lines.map((line) => line.serviceDate);
  const undated = lines.filter((line) => !line.serviceDate);
  if (!periodStart || !periodEnd || undated.length === 0) {
    return { dates, warnings: [] };
  }
  const period = formatPeriod(periodStart, periodEnd);
  const professionalIds = [...new Set(undated.flatMap((line) => (line.timekeeperProfessionalId ? [line.timekeeperProfessionalId] : [])))];

  const rates = await listRates(tx, professionalIds);
  // A rate starting inside the period, after its first day.
  const changes = new Map<string, string>();
  for (const rate of rates) {
    if (rate.effectiveFrom > periodStart && rate.effectiveFrom <= periodEnd && !changes.has(rate.professionalId)) {
      changes.set(rate.professionalId, rate.effectiveFrom);
    }
  }
  const covering =
    professionalIds.length === 0
      ? []
      : await tx
          .selectDistinct({ professionalId: caseAssignment.professionalId })
          .from(caseAssignment)
          .where(
            and(
              eq(caseAssignment.caseId, caseId),
              inArray(caseAssignment.professionalId, professionalIds),
              lte(sql`${caseAssignment.assignedAt}::date`, periodStart),
              or(isNull(caseAssignment.endedAt), sql`${caseAssignment.endedAt}::date > ${periodEnd}`),
            ),
          );
  const assignedThroughout = new Set(covering.map((row) => row.professionalId));
  const names = new Map(
    professionalIds.length === 0
      ? []
      : (
          await tx
            .select({ professionalId: professional.professionalId, displayName: professional.displayName })
            .from(professional)
            .where(inArray(professional.professionalId, professionalIds))
        ).map((row) => [row.professionalId, row.displayName ?? 'This professional']),
  );

  const warnings: ImportWarning[] = [];
  lines.forEach((line, index) => {
    if (line.serviceDate) {
      return;
    }
    const who = line.timekeeperProfessionalId;
    const left = (reason: string) =>
      warnings.push({ code: 'date_not_inferred', location: line.location, message: `No date in the file. ${reason}` });
    if (!who) {
      left(`Choose who did the work, then enter this item's date (the billing period is ${period}).`);
    } else if (line.lineType === 'time' && changes.has(who)) {
      left(`${names.get(who)}'s rate changed on ${changes.get(who)}, during the billing period, so enter this item's date.`);
    } else if (!assignedThroughout.has(who)) {
      left(`${names.get(who)} wasn't assigned to this case for the whole billing period (${period}), so enter this item's date.`);
    } else {
      dates[index] = periodEnd;
      warnings.push({
        code: DATE_FROM_PERIOD_WARNING,
        location: line.location,
        message: `No date in the file, so it's set to the end of the billing period (${period}). Check it.`,
      });
    }
  });
  return { dates, warnings };
}
