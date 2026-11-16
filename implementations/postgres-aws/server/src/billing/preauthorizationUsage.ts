// model/rules.yaml report_preauthorization_usage. Requests count by date received; limits are as of today.
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import {
  caseTable,
  county,
  invoice,
  invoiceEvent,
  invoiceEventTypes,
  invoiceOverrunExplanation,
  invoiceStatuses,
  preauthorization,
  preauthorizationDecision,
  preauthorizationOutcomes,
  preauthorizationRequest,
  preauthorizationRequestStatuses,
  preauthorizationStatuses,
} from '../db/schema';
import { ForbiddenError, ValidationError } from '../errors';
import { isStaffAccount } from '../portal/portalActor';
import { groupBy } from '../groupBy';
import { fromCents, toCents } from './money';
import { approvedCentsByInvoice, loadPreauthorizationSummariesByCase } from './preauthorizations';
import { loadThresholdTable, thresholdFrom } from './preauthorizationThresholds';
import { APPROVED_INVOICE_STATUS_CODE, IN_REVIEW_INVOICE_STATUS_CODES } from './invoiceStatusCodes';

export interface CountyUsage {
  countyId: string | null;
  countyName: string;
  isCounty: boolean;
  threshold: string | null;
  requests: Record<'submitted' | 'info_requested' | 'approved' | 'not_needed' | 'denied' | 'withdrawn', number>;
  requested: string;
  approved: string;
  // Current ceilings of the pre-authorizations on these cases.
  authorized: string;
  billedApproved: string;
  billedWaiting: string;
  left: string;
  over: { providers: number; amount: string; unexplained: number };
  withinThreshold: { providers: number; billed: string };
}

// Month-end totals; null for months not yet begun. withInReview is only on this month, and last month to join the line.
export interface UsageMonth {
  month: string;
  authorized: string | null;
  signedOff: string | null;
  withInReview: string | null;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function preauthorizationUsageByCounty(
  db: DatabaseOrTransaction,
  actorUserAccountId: string,
  period: { from: string; to: string },
): Promise<{ from: string; to: string; counties: CountyUsage[]; total: CountyUsage; months: UsageMonth[] }> {
  if (!(await isStaffAccount(db, actorUserAccountId))) throw new ForbiddenError('forbidden', 'Only staff can see usage.');
  if (!isoDate.test(period.from) || !isoDate.test(period.to) || period.from > period.to) {
    throw new ValidationError({ from: 'Choose a start date on or before the end date.' });
  }
  const start = new Date(`${period.from}T00:00:00Z`);
  const end = new Date(new Date(`${period.to}T00:00:00Z`).getTime() + 86_400_000);
  const [requests, sent, counties, thresholds] = await Promise.all([
    db
      .select({
        caseId: preauthorizationRequest.caseId,
        countyId: caseTable.countyId,
        proposedCountyId: sql<string | null>`${preauthorizationRequest.proposedDetails}->'case'->>'countyId'`,
        statusCode: preauthorizationRequestStatuses.code,
        requestedAmount: preauthorizationRequest.requestedAmount,
        approvedAmount: preauthorizationDecision.approvedAmount,
      })
      .from(preauthorizationRequest)
      .innerJoin(preauthorizationRequestStatuses, eq(preauthorizationRequest.statusId, preauthorizationRequestStatuses.id))
      .leftJoin(caseTable, eq(preauthorizationRequest.caseId, caseTable.caseId))
      .leftJoin(preauthorizationDecision, eq(preauthorizationRequest.preauthorizationDecisionId, preauthorizationDecision.preauthorizationDecisionId))
      .where(and(gte(preauthorizationRequest.receivedAt, start), lt(preauthorizationRequest.receivedAt, end))),
    db
      .selectDistinct({ caseId: invoice.caseId })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(
        and(
          isNotNull(invoice.caseId),
          gte(invoice.submittedAt, start),
          lt(invoice.submittedAt, end),
          inArray(invoiceStatuses.code, [APPROVED_INVOICE_STATUS_CODE, ...IN_REVIEW_INVOICE_STATUS_CODES]),
        ),
      ),
    db.select({ countyId: county.countyId, displayName: county.displayName, isCounty: county.isCounty }).from(county),
    loadThresholdTable(db, period.to),
  ]);
  const caseIds = [...new Set([...requests.flatMap((row) => (row.caseId ? [row.caseId] : [])), ...sent.map((row) => row.caseId!)])];
  const caseCounties =
    caseIds.length === 0
      ? []
      : await db.select({ caseId: caseTable.caseId, countyId: caseTable.countyId }).from(caseTable).where(inArray(caseTable.caseId, caseIds));
  const explained =
    caseIds.length === 0
      ? []
      : await db
          .selectDistinct({ caseId: invoice.caseId, professionalId: invoiceOverrunExplanation.professionalId })
          .from(invoiceOverrunExplanation)
          .innerJoin(invoice, eq(invoiceOverrunExplanation.invoiceId, invoice.invoiceId))
          .where(inArray(invoice.caseId, caseIds));
  const explainedKeys = new Set(explained.map((row) => `${row.caseId}:${row.professionalId}`));

  const rows = new Map<string | null, CountyUsage>();
  const rowFor = (countyId: string | null): CountyUsage => {
    let row = rows.get(countyId);
    if (!row) {
      const named = counties.find((c) => c.countyId === countyId);
      row = emptyUsage(countyId, named?.displayName ?? 'No county', named?.isCounty ?? true, thresholdFrom(thresholds, countyId)?.amount ?? null);
      rows.set(countyId, row);
    }
    return row;
  };

  for (const request of requests) {
    const row = rowFor(request.countyId ?? request.proposedCountyId ?? null);
    const bucket = request.statusCode as keyof CountyUsage['requests'];
    row.requests[bucket] = (row.requests[bucket] ?? 0) + 1;
    row.requested = add(row.requested, request.requestedAmount);
    if (request.approvedAmount) row.approved = add(row.approved, request.approvedAmount);
  }

  const thresholdsToday = await loadThresholdTable(db);
  const summariesByCase = await loadPreauthorizationSummariesByCase(db, caseCounties.map(({ caseId }) => caseId), [], thresholdsToday);
  for (const { caseId, countyId } of caseCounties) {
    const row = rowFor(countyId);
    for (const summary of summariesByCase.get(caseId)!) {
      const used = toCents(summary.approvedSoFar) + toCents(summary.waiting);
      if (summary.source === 'preauthorized') row.authorized = add(row.authorized, summary.ceiling);
      row.billedApproved = add(row.billedApproved, summary.approvedSoFar);
      row.billedWaiting = add(row.billedWaiting, summary.waiting);
      row.left = fromCents(toCents(row.left) + Math.max(0, toCents(summary.ceiling) - used));
      if (used > toCents(summary.ceiling)) {
        row.over.providers += 1;
        row.over.amount = fromCents(toCents(row.over.amount) + used - toCents(summary.ceiling));
        if (!explainedKeys.has(`${caseId}:${summary.professionalId}`)) row.over.unexplained += 1;
      } else if (summary.source === 'threshold' && used > 0) {
        row.withinThreshold.providers += 1;
        row.withinThreshold.billed = fromCents(toCents(row.withinThreshold.billed) + used);
      }
    }
  }

  const list = [...rows.values()].sort(
    (a, b) => Number(a.countyId === null) - Number(b.countyId === null) || Number(a.isCounty) - Number(b.isCounty) || a.countyName.localeCompare(b.countyName),
  );
  return { from: period.from, to: period.to, counties: list, total: totalOf(list), months: await monthlyTotals(db, period, caseCounties.map(({ caseId }) => caseId)) };
}

// Longer periods return no months, so the chart stays a readable size.
const MAX_CHART_MONTHS = 60;

// Month-end totals for the table's cases, covered as in loadPreauthorizationSummariesByCase; a sign-off counts from its grant if later.
async function monthlyTotals(db: DatabaseOrTransaction, period: { from: string; to: string }, caseIds: string[]): Promise<UsageMonth[]> {
  const first = new Date(`${period.from.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${period.to.slice(0, 7)}-01T00:00:00Z`);
  const count = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
  if (count > MAX_CHART_MONTHS) return [];
  const monthStart = (offset: number) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1));
  const months = Array.from({ length: count }, (_, index) => ({ month: monthStart(index).toISOString().slice(0, 7), end: monthStart(index + 1).getTime() }));
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

  // One row per decision on each approved pre-authorization.
  const decisions =
    caseIds.length === 0
      ? []
      : await db
          .select({
            preauthorizationId: preauthorization.preauthorizationId,
            caseId: preauthorization.caseId,
            professionalId: preauthorization.professionalId,
            sequenceNumber: preauthorizationDecision.sequenceNumber,
            outcomeCode: preauthorizationOutcomes.code,
            approvedAmount: preauthorizationDecision.approvedAmount,
            effectiveAt: preauthorizationDecision.effectiveAt,
          })
          .from(preauthorization)
          .innerJoin(preauthorizationStatuses, eq(preauthorization.statusId, preauthorizationStatuses.id))
          .innerJoin(preauthorizationDecision, eq(preauthorizationDecision.preauthorizationId, preauthorization.preauthorizationId))
          .innerJoin(preauthorizationOutcomes, eq(preauthorizationDecision.outcomeId, preauthorizationOutcomes.id))
          .where(and(inArray(preauthorization.caseId, caseIds), eq(preauthorizationStatuses.code, 'approved')))
          .orderBy(preauthorizationDecision.sequenceNumber);
  const authorizedCaseIds = [...new Set(decisions.map((row) => row.caseId))];
  const invoices =
    authorizedCaseIds.length === 0
      ? []
      : await db
          .select({
            invoiceId: invoice.invoiceId,
            caseId: invoice.caseId,
            professionalId: invoice.professionalId,
            statusCode: invoiceStatuses.code,
            submittedTotal: invoice.submittedTotal,
            signedOffAt: sql<string | null>`(select max(${invoiceEvent.occurredAt}) from ${invoiceEvent} join ${invoiceEventTypes} on ${invoiceEventTypes.id} = ${invoiceEvent.eventTypeId} where ${invoiceEvent.invoiceId} = ${invoice.invoiceId} and ${invoiceEventTypes.code} = 'approved')`,
          })
          .from(invoice)
          .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
          .where(and(inArray(invoice.caseId, authorizedCaseIds), inArray(invoiceStatuses.code, [APPROVED_INVOICE_STATUS_CODE, ...IN_REVIEW_INVOICE_STATUS_CODES])));

  const authorizedChanges: Array<{ at: number; cents: number }> = [];
  const grantedAt = new Map<string, { caseId: string; professionalId: string | null; at: number }>();
  for (const own of groupBy(decisions, (row) => row.preauthorizationId).values()) {
    let ceiling = 0;
    for (const decision of own) {
      const next = decision.outcomeCode === 'denied' ? 0 : toCents(decision.approvedAmount);
      authorizedChanges.push({ at: decision.effectiveAt.getTime(), cents: next - ceiling });
      ceiling = next;
      const key = `${decision.caseId}:${decision.professionalId}`;
      const granted = grantedAt.get(key);
      if (!granted || decision.effectiveAt.getTime() < granted.at) {
        grantedAt.set(key, { caseId: decision.caseId, professionalId: decision.professionalId, at: decision.effectiveAt.getTime() });
      }
    }
  }

  const invoicesOf = groupBy(invoices, (row) => row.caseId!);
  const covered = [...grantedAt.values()].flatMap((granted) =>
    (invoicesOf.get(granted.caseId) ?? [])
      .filter((row) => granted.professionalId === null || row.professionalId === granted.professionalId)
      .map((row) => ({ ...row, grantedAt: granted.at })),
  );
  const approved = covered.filter((row) => row.statusCode === APPROVED_INVOICE_STATUS_CODE);
  const approvedCents = await approvedCentsByInvoice(db, [...new Set(approved.map((row) => row.invoiceId))]);
  const signedOffChanges = approved.map((row) => ({
    at: Math.max(row.signedOffAt ? new Date(row.signedOffAt).getTime() : 0, row.grantedAt),
    cents: approvedCents.get(row.invoiceId)!,
  }));
  const waitingCents = covered.filter((row) => row.statusCode !== APPROVED_INVOICE_STATUS_CODE).reduce((sum, row) => sum + toCents(row.submittedTotal), 0);

  const runningTotals = (changes: Array<{ at: number; cents: number }>) => {
    changes.sort((a, b) => a.at - b.at);
    let next = 0;
    let total = 0;
    return months.map(({ end }) => {
      while (next < changes.length && changes[next]!.at < end) total += changes[next++]!.cents;
      return total;
    });
  };
  const authorized = runningTotals(authorizedChanges);
  const signedOff = runningTotals(signedOffChanges);
  return months.map(({ month }, index) => {
    if (month > thisMonth) return { month, authorized: null, signedOff: null, withInReview: null };
    const withInReview = month === thisMonth ? signedOff[index]! + waitingCents : month === lastMonth ? signedOff[index]! : null;
    return {
      month,
      authorized: fromCents(authorized[index]!),
      signedOff: fromCents(signedOff[index]!),
      withInReview: withInReview === null ? null : fromCents(withInReview),
    };
  });
}

function emptyUsage(countyId: string | null, countyName: string, isCounty: boolean, threshold: string | null): CountyUsage {
  return {
    countyId,
    countyName,
    isCounty,
    threshold,
    requests: { submitted: 0, info_requested: 0, approved: 0, not_needed: 0, denied: 0, withdrawn: 0 },
    requested: '0.00',
    approved: '0.00',
    authorized: '0.00',
    billedApproved: '0.00',
    billedWaiting: '0.00',
    left: '0.00',
    over: { providers: 0, amount: '0.00', unexplained: 0 },
    withinThreshold: { providers: 0, billed: '0.00' },
  };
}

function add(a: string, b: string | null): string {
  return fromCents(toCents(a) + toCents(b));
}

function totalOf(rows: CountyUsage[]): CountyUsage {
  const total = emptyUsage(null, 'All', true, null);
  for (const row of rows) {
    for (const key of Object.keys(total.requests) as Array<keyof CountyUsage['requests']>) total.requests[key] += row.requests[key];
    total.requested = add(total.requested, row.requested);
    total.approved = add(total.approved, row.approved);
    total.authorized = add(total.authorized, row.authorized);
    total.billedApproved = add(total.billedApproved, row.billedApproved);
    total.billedWaiting = add(total.billedWaiting, row.billedWaiting);
    total.left = add(total.left, row.left);
    total.over.providers += row.over.providers;
    total.over.amount = add(total.over.amount, row.over.amount);
    total.over.unexplained += row.over.unexplained;
    total.withinThreshold.providers += row.withinThreshold.providers;
    total.withinThreshold.billed = add(total.withinThreshold.billed, row.withinThreshold.billed);
  }
  return total;
}
