// Dates for imported lines that have none, from the file's billing period
// (model/rules.yaml validate_invoice_import): the period's end, marked as
// inferred, unless the person's rate changes inside the period, they weren't
// assigned to the case for all of it, or who did the work isn't known yet.
// Confirmation and submission repeat the checks for whoever a line then names.
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { caseAssignment, invoice, invoiceLine, invoiceLineTypes, professional } from '../db/schema';
import { ValidationError } from '../errors';
import { listRates } from '../billing/professionalRates';
import type { ImportWarning } from './parsedInvoice';

export const DATE_FROM_PERIOD_WARNING = 'date_from_period';

interface UndatedLine {
  location: string;
  lineType: string;
  serviceDate?: string;
  timekeeperProfessionalId?: string;
}

interface Period {
  // Null for an invoice with no case: there is no assignment to check.
  caseId: string | null;
  periodStart: string;
  periodEnd: string;
}

function formatPeriod(start: string, end: string): string {
  return `${start} to ${end}`;
}

// Why a period-end date would be wrong for each person, if it would.
async function periodEndBlockers(
  tx: Transaction,
  { caseId, periodStart, periodEnd }: Period,
  professionalIds: string[],
): Promise<(professionalId: string, lineType: string) => string | undefined> {
  if (professionalIds.length === 0) {
    return () => undefined;
  }
  const rates = await listRates(tx, professionalIds);
  // A rate starting inside the period, after its first day.
  const changes = new Map<string, string>();
  for (const rate of rates) {
    if (rate.effectiveFrom > periodStart && rate.effectiveFrom <= periodEnd && !changes.has(rate.professionalId)) {
      changes.set(rate.professionalId, rate.effectiveFrom);
    }
  }
  const covering =
    caseId === null
      ? professionalIds.map((professionalId) => ({ professionalId }))
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
    (
      await tx
        .select({ professionalId: professional.professionalId, displayName: professional.displayName })
        .from(professional)
        .where(inArray(professional.professionalId, professionalIds))
    ).map((row) => [row.professionalId, row.displayName ?? 'This professional']),
  );
  const period = formatPeriod(periodStart, periodEnd);
  return (professionalId, lineType) => {
    if (lineType === 'time' && changes.has(professionalId)) {
      return `${names.get(professionalId)}'s rate changed on ${changes.get(professionalId)}, during the billing period`;
    }
    if (!assignedThroughout.has(professionalId)) {
      return `${names.get(professionalId)} wasn't assigned to this case for the whole billing period (${period})`;
    }
    return undefined;
  };
}

export async function inferServiceDates(
  tx: Transaction,
  args: { caseId: string | null; periodStart?: string; periodEnd?: string; lines: UndatedLine[] },
): Promise<{ dates: Array<string | undefined>; inferred: boolean[]; warnings: ImportWarning[] }> {
  const { periodStart, periodEnd, caseId, lines } = args;
  const dates = lines.map((line) => line.serviceDate);
  const inferred = lines.map(() => false);
  const undated = lines.filter((line) => !line.serviceDate);
  if (!periodStart || !periodEnd || undated.length === 0) {
    return { dates, inferred, warnings: [] };
  }
  const period = formatPeriod(periodStart, periodEnd);
  const blocker = await periodEndBlockers(
    tx,
    { caseId, periodStart, periodEnd },
    [...new Set(undated.flatMap((line) => (line.timekeeperProfessionalId ? [line.timekeeperProfessionalId] : [])))],
  );

  const warnings: ImportWarning[] = [];
  lines.forEach((line, index) => {
    if (line.serviceDate) {
      return;
    }
    const who = line.timekeeperProfessionalId;
    const reason = who
      ? blocker(who, line.lineType)
      : `Choose who did the work, then enter this item's date (the billing period is ${period})`;
    if (reason) {
      warnings.push({
        code: 'date_not_inferred',
        location: line.location,
        message: `No date in the file. ${reason}${who ? ", so enter this item's date" : ''}.`,
      });
      return;
    }
    dates[index] = periodEnd;
    inferred[index] = true;
    warnings.push({
      code: DATE_FROM_PERIOD_WARNING,
      location: line.location,
      message: `No date in the file, so it's set to the end of the billing period (${period}). Check it.`,
    });
  });
  return { dates, inferred, warnings };
}

// Refuses an inferred date that has become unsafe, e.g. after "work done by"
// was changed to someone whose rate changed during the period.
export async function checkInferredDates(tx: Transaction, invoiceId: string): Promise<void> {
  const [row] = await tx
    .select({ caseId: invoice.caseId, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, billed: invoice.professionalId })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row?.periodStart || !row.periodEnd) {
    return;
  }
  const lines = await tx
    .select({
      description: invoiceLine.description,
      lineTypeCode: invoiceLineTypes.code,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
    })
    .from(invoiceLine)
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .where(and(eq(invoiceLine.invoiceId, invoiceId), eq(invoiceLine.serviceDateInferred, true)));
  if (lines.length === 0) {
    return;
  }
  const whoFor = (line: (typeof lines)[number]) => line.timekeeperProfessionalId ?? row.billed;
  const blocker = await periodEndBlockers(
    tx,
    { caseId: row.caseId, periodStart: row.periodStart, periodEnd: row.periodEnd },
    [...new Set(lines.flatMap((line) => whoFor(line) ?? []))],
  );
  for (const line of lines) {
    const professionalId = whoFor(line);
    // No one to check yet: an intake invoice whose professional isn't chosen.
    const reason = professionalId ? blocker(professionalId, line.lineTypeCode === 'time' ? 'time' : 'other') : undefined;
    if (reason) {
      const item = line.description ? `"${line.description}"` : 'An item';
      throw new ValidationError({
        lines: `${item} is dated to the end of the billing period, but ${reason}. Enter its date.`,
      });
    }
  }
}
