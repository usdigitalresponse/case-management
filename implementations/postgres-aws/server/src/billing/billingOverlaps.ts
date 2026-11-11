// Possible double billing (model/rules.yaml flag_overlapping_invoice_period).
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalOutcomes,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  professional,
  supportingInvoice,
  timeEntry,
} from '../db/schema';
import type { PortalActor } from '../portal/portalActor';
import { portalReadableInvoiceCondition } from './invoiceAccess';
import { closeKey, currentCaseNumber } from './caseNumbers';
import { loadCaseNumbers } from './invoiceDetail';
import { DRAFT_INVOICE_STATUS_CODE, REJECTED_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

export interface OverlapLine {
  invoiceLineId: string;
  serviceDate: string | null;
  lineTypeCode: string;
  description: string | null;
  quantity: string | null;
  amount: string;
  workerDisplayName: string | null;
  // Lines here with the same date, person, type and quantity.
  sameAsLineIds: string[];
}

export interface BillingOverlap {
  invoiceId: string;
  // On this case: its dates overlap. On another: time on the same dates.
  sameCase: boolean;
  caseId: string | null;
  caseNumber: string | null;
  invoiceNumber: string | null;
  professionalDisplayName: string | null;
  statusCode: string;
  statusDisplayName: string;
  submittedAt: Date | null;
  // Its billing period and line dates together.
  periodStart: string | null;
  periodEnd: string | null;
  submittedTotal: string;
  lines: OverlapLine[];
}

// Rejected requests pay nothing; a sent-back draft counts, as it will likely return.
const NOT_COUNTED = [WITHDRAWN_INVOICE_STATUS_CODE, REJECTED_INVOICE_STATUS_CODE];

const worker = sql<string | null>`coalesce(${timeEntry.professionalId}, ${invoiceLine.timekeeperProfessionalId}, ${invoice.professionalId})`;
const workDate = sql<string | null>`coalesce(${timeEntry.activityOn}, ${invoiceLine.serviceDate})`;
const workQuantity = sql<string | null>`coalesce(${timeEntry.durationHours}, ${invoiceLine.quantity})`;
// The latest recorded decision on the line, in its current review, rejected it.
const rejectedLine = sql<boolean>`coalesce((
  select ${invoiceApprovalOutcomes.code} = 'rejected'
  from ${invoiceApprovalDecision}
  join ${invoiceApprovalChain} on ${invoiceApprovalChain.invoiceApprovalChainId} = ${invoiceApprovalDecision.invoiceApprovalChainId}
  join ${invoiceApprovalOutcomes} on ${invoiceApprovalOutcomes.id} = ${invoiceApprovalDecision.outcomeId}
  where ${invoiceApprovalDecision.invoiceLineId} = ${invoiceLine.invoiceLineId} and ${invoiceApprovalChain.supersededAt} is null
  order by ${invoiceApprovalDecision.sequenceNumber} desc limit 1
), false)`;

function selectLines(db: Database) {
  return db
    .select({
      invoiceId: invoiceLine.invoiceId,
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      workerId: worker,
      serviceDate: workDate,
      quantity: workQuantity,
      description: invoiceLine.description,
      amount: invoiceLine.amount,
      rejected: rejectedLine,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId));
}

function rangeOf(periodStart: string | null, periodEnd: string | null, lineDates: string[]): [string, string] | null {
  const dates = [periodStart, periodEnd, ...lineDates].filter((date): date is string => Boolean(date)).sort();
  return dates.length === 0 ? null : [dates[0]!, dates[dates.length - 1]!];
}

type CaseRef = { caseId: string | null; caseNumberAsTyped: string | null; caseNumberCorrected: string | null };

// A submitter (`reader`) sees only the invoices the portal lets them read.
export async function findBillingOverlaps(db: Database, invoiceId: string, reader?: PortalActor): Promise<BillingOverlap[]> {
  const [header] = await db
    .select({
      professionalId: invoice.professionalId,
      caseId: invoice.caseId,
      caseNumberAsTyped: invoice.caseNumberAsTyped,
      caseNumberCorrected: invoice.caseNumberCorrected,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
    })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId));
  if (!header) {
    return [];
  }
  const own = await selectLines(db).where(eq(invoiceLine.invoiceId, invoiceId));
  const range = rangeOf(header.periodStart, header.periodEnd, own.flatMap((line) => line.serviceDate ?? []));
  const workers = [...new Set([...own.flatMap((line) => line.workerId ?? []), ...(header.professionalId ? [header.professionalId] : [])])];
  if (!range || workers.length === 0) {
    return [];
  }
  const [start, end] = range;

  // Narrowed through indexed columns; only the candidates' lines are compared in full.
  const candidates = await db
    .selectDistinct({ invoiceId: invoice.invoiceId })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(
      and(
        ne(invoice.invoiceId, invoiceId),
        notInArray(invoiceStatuses.code, NOT_COUNTED),
        or(ne(invoiceStatuses.code, DRAFT_INVOICE_STATUS_CODE), isNotNull(invoice.submittedAt)),
        or(
          and(
            inArray(invoice.professionalId, workers),
            or(isNull(invoice.periodStart), and(lte(invoice.periodStart, end), gte(invoice.periodEnd, start))),
          ),
          inArray(
            invoice.invoiceId,
            db
              .select({ invoiceId: invoiceLine.invoiceId })
              .from(invoiceLine)
              .where(and(inArray(invoiceLine.timekeeperProfessionalId, workers), gte(invoiceLine.serviceDate, start), lte(invoiceLine.serviceDate, end))),
          ),
          inArray(
            invoice.invoiceId,
            db
              .select({ invoiceId: invoiceLine.invoiceId })
              .from(timeEntry)
              .innerJoin(invoiceLine, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
              .where(and(inArray(timeEntry.professionalId, workers), gte(timeEntry.activityOn, start), lte(timeEntry.activityOn, end))),
          ),
        ),
      ),
    );
  const candidateIds = candidates.map((row) => row.invoiceId);
  if (candidateIds.length === 0) {
    return [];
  }
  const candidateLines = await selectLines(db).where(inArray(invoiceLine.invoiceId, candidateIds));
  const nearbyLines = candidateLines.filter(
    (line) =>
      !line.rejected &&
      line.workerId !== null &&
      workers.includes(line.workerId) &&
      line.serviceDate !== null &&
      line.serviceDate >= start &&
      line.serviceDate <= end,
  );
  const invoices = await db
    .select({
      invoiceId: invoice.invoiceId,
      caseId: invoice.caseId,
      caseNumberAsTyped: invoice.caseNumberAsTyped,
      caseNumberCorrected: invoice.caseNumberCorrected,
      invoiceNumber: sql<string | null>`(select ${supportingInvoice.invoiceNumber} from ${supportingInvoice} where ${supportingInvoice.invoiceId} = ${invoice.invoiceId} limit 1)`,
      professionalDisplayName: professional.displayName,
      statusCode: invoiceStatuses.code,
      statusDisplayName: invoiceStatuses.displayName,
      submittedAt: invoice.submittedAt,
      professionalId: invoice.professionalId,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      submittedTotal: invoice.submittedTotal,
    })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .where(
      and(
        inArray(invoice.invoiceId, candidateIds),
        ...(reader ? [portalReadableInvoiceCondition(db, reader)] : []),
      ),
    );

  const caseNumbers = await loadCaseNumbers(db, [header.caseId, ...invoices.map((row) => row.caseId)]);
  const keysOf = (ref: CaseRef) => {
    const known = caseNumbers.get(ref.caseId);
    const numbers = [currentCaseNumber(ref), known?.caseNumber ?? null, ...(known?.otherNumbers ?? [])];
    return new Set(numbers.flatMap((value) => (value ? [closeKey(value)] : [])).filter(Boolean));
  };
  const ownKeys = keysOf(header);
  const sameCaseAs = (ref: CaseRef) =>
    (header.caseId !== null && ref.caseId === header.caseId) || [...keysOf(ref)].some((key) => ownKeys.has(key));

  const names = await workerNames(db, [...new Set(nearbyLines.flatMap((line) => line.workerId ?? []))]);
  const ownTimeDays = new Set(own.filter((line) => line.lineTypeCode === 'time').map((line) => `${line.workerId}|${line.serviceDate}`));
  const overlaps: BillingOverlap[] = [];
  for (const row of invoices) {
    const sameCase = sameCaseAs(row);
    const its = rangeOf(
      row.periodStart,
      row.periodEnd,
      candidateLines.flatMap((line) => (line.invoiceId === row.invoiceId && line.serviceDate ? [line.serviceDate] : [])),
    );
    const datesOverlap =
      header.professionalId !== null && row.professionalId === header.professionalId && its !== null && its[0] <= end && its[1] >= start;
    const lines = nearbyLines.filter(
      (line) =>
        line.invoiceId === row.invoiceId &&
        (sameCase || (line.lineTypeCode === 'time' && ownTimeDays.has(`${line.workerId}|${line.serviceDate}`))),
    );
    if (!(sameCase && datesOverlap) && lines.length === 0) {
      continue;
    }
    overlaps.push({
      invoiceId: row.invoiceId,
      sameCase,
      caseId: row.caseId,
      caseNumber: caseNumbers.get(row.caseId)?.caseNumber ?? currentCaseNumber(row),
      invoiceNumber: row.invoiceNumber,
      professionalDisplayName: row.professionalDisplayName,
      statusCode: row.statusCode,
      statusDisplayName: row.statusDisplayName,
      submittedAt: row.submittedAt,
      periodStart: its?.[0] ?? null,
      periodEnd: its?.[1] ?? null,
      submittedTotal: row.submittedTotal,
      lines: lines
        .sort((a, b) => (a.serviceDate ?? '').localeCompare(b.serviceDate ?? ''))
        .map((line) => ({
          invoiceLineId: line.invoiceLineId,
          serviceDate: line.serviceDate,
          lineTypeCode: line.lineTypeCode,
          description: line.description,
          quantity: line.quantity,
          amount: line.amount,
          workerDisplayName: (line.workerId && names.get(line.workerId)) ?? null,
          sameAsLineIds: own
            .filter(
              (mine) =>
                mine.serviceDate !== null &&
                mine.serviceDate === line.serviceDate &&
                mine.workerId === line.workerId &&
                mine.lineTypeCode === line.lineTypeCode &&
                mine.quantity !== null &&
                Number(mine.quantity) === Number(line.quantity),
            )
            .map((mine) => mine.invoiceLineId),
        })),
    });
  }
  return overlaps.sort(
    (a, b) => Number(b.sameCase) - Number(a.sameCase) || (a.periodStart ?? '').localeCompare(b.periodStart ?? ''),
  );
}

async function workerNames(db: Database, professionalIds: string[]): Promise<Map<string, string | null>> {
  if (professionalIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ professionalId: professional.professionalId, displayName: professional.displayName })
    .from(professional)
    .where(inArray(professional.professionalId, professionalIds));
  return new Map(rows.map((row) => [row.professionalId, row.displayName]));
}
