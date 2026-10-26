// How much of each professional's pre-authorization on a case is used:
// the ceiling, approved so far and waiting for a decision. Reviewers check
// this by hand without it. Approximation (../../MAPPING.md): "approved so
// far" sums signed-off invoices for that professional on the case, not
// invoice_authorization_allocation draws, which are not built.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import {
  invoice,
  invoiceApprovalChain,
  invoiceLine,
  invoiceStatuses,
  preauthorization,
  preauthorizationDecision,
  preauthorizationOutcomes,
  preauthorizationStatuses,
} from '../db/schema';
import { latestRoundNumber, loadRecordedDecisions } from './reviewRounds';
import { APPROVED_INVOICE_STATUS_CODE, IN_REVIEW_INVOICE_STATUS_CODES } from './invoiceStatusCodes';

export interface PreauthorizationSummary {
  professionalId: string | null;
  authorizationNumbers: string[];
  ceiling: string;
  approvedSoFar: string;
  waiting: string;
}

const money = (cents: number) => (cents / 100).toFixed(2);
const toCents = (value: string | null) => Math.round(Number(value ?? 0) * 100);

async function approvedCents(db: DatabaseOrTransaction, invoiceId: string): Promise<number> {
  const [chain] = await db
    .select({ id: invoiceApprovalChain.invoiceApprovalChainId })
    .from(invoiceApprovalChain)
    .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
  if (!chain) {
    return 0;
  }
  const [decisions, lines] = await Promise.all([
    loadRecordedDecisions(db, chain.id),
    db.select({ id: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)),
  ]);
  const round = latestRoundNumber(decisions, lines.length);
  return decisions
    .filter((decision) => decision.sequenceNumber === round && decision.invoiceLineId)
    .reduce((sum, decision) => sum + toCents(decision.approvedAmount), 0);
}

// The pre-authorized hourly rate per professional on a case (null key: a
// pre-authorization for the whole case), from each approved
// pre-authorization's latest decision that set one.
export async function loadRateLimits(db: DatabaseOrTransaction, caseId: string | null): Promise<Map<string | null, string>> {
  if (caseId === null) {
    return new Map();
  }
  const rows = await db
    .select({
      preauthorizationId: preauthorization.preauthorizationId,
      professionalId: preauthorization.professionalId,
      rate: preauthorizationDecision.approvedHourlyRate,
      outcomeCode: preauthorizationOutcomes.code,
    })
    .from(preauthorization)
    .innerJoin(preauthorizationStatuses, eq(preauthorization.statusId, preauthorizationStatuses.id))
    .innerJoin(preauthorizationDecision, eq(preauthorizationDecision.preauthorizationId, preauthorization.preauthorizationId))
    .innerJoin(preauthorizationOutcomes, eq(preauthorizationDecision.outcomeId, preauthorizationOutcomes.id))
    .where(and(eq(preauthorization.caseId, caseId), eq(preauthorizationStatuses.code, 'approved')))
    .orderBy(desc(preauthorizationDecision.sequenceNumber));
  const limits = new Map<string | null, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    // Only each pre-authorization's latest decision counts.
    if (seen.has(row.preauthorizationId)) continue;
    seen.add(row.preauthorizationId);
    if (row.rate !== null && row.outcomeCode !== 'denied' && !limits.has(row.professionalId)) {
      limits.set(row.professionalId, row.rate);
    }
  }
  return limits;
}

export interface RateLimit {
  rate: string;
  source: 'preauthorized' | 'configured';
}

// The rate a time line is checked against: the pre-authorized rate for the
// professional whose work it is, else the case's, else the configured rate.
export function rateLimitFor(
  line: { timekeeperProfessionalId: string | null; configuredRate: string | null },
  invoiceProfessionalId: string,
  limits: Map<string | null, string>,
): RateLimit | null {
  const preauthorized = limits.get(line.timekeeperProfessionalId ?? invoiceProfessionalId) ?? limits.get(null);
  if (preauthorized) return { rate: preauthorized, source: 'preauthorized' };
  return line.configuredRate === null ? null : { rate: line.configuredRate, source: 'configured' };
}

export async function loadPreauthorizationSummaries(db: DatabaseOrTransaction, caseId: string): Promise<PreauthorizationSummary[]> {
  const authorizations = await db
    .select({
      preauthorizationId: preauthorization.preauthorizationId,
      professionalId: preauthorization.professionalId,
      authorizationNumber: preauthorization.authorizationNumber,
    })
    .from(preauthorization)
    .innerJoin(preauthorizationStatuses, eq(preauthorization.statusId, preauthorizationStatuses.id))
    .where(and(eq(preauthorization.caseId, caseId), eq(preauthorizationStatuses.code, 'approved')))
    .orderBy(asc(preauthorization.requestedAt));
  if (authorizations.length === 0) {
    return [];
  }
  const decisions = await db
    .select({
      preauthorizationId: preauthorizationDecision.preauthorizationId,
      outcomeCode: preauthorizationOutcomes.code,
      approvedAmount: preauthorizationDecision.approvedAmount,
    })
    .from(preauthorizationDecision)
    .innerJoin(preauthorizationOutcomes, eq(preauthorizationDecision.outcomeId, preauthorizationOutcomes.id))
    .where(inArray(preauthorizationDecision.preauthorizationId, authorizations.map((row) => row.preauthorizationId)))
    .orderBy(desc(preauthorizationDecision.sequenceNumber));
  const invoices = await db
    .select({
      invoiceId: invoice.invoiceId,
      professionalId: invoice.professionalId,
      statusCode: invoiceStatuses.code,
      submittedTotal: invoice.submittedTotal,
    })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(and(eq(invoice.caseId, caseId), inArray(invoiceStatuses.code, [APPROVED_INVOICE_STATUS_CODE, ...IN_REVIEW_INVOICE_STATUS_CODES])));

  const byProfessional = new Map<string | null, PreauthorizationSummary>();
  for (const authorization of authorizations) {
    // Ceilings replace each other; the latest decision sets it.
    const latest = decisions.find((decision) => decision.preauthorizationId === authorization.preauthorizationId);
    const ceilingCents = latest && latest.outcomeCode !== 'denied' ? toCents(latest.approvedAmount) : 0;
    const summary = byProfessional.get(authorization.professionalId) ?? {
      professionalId: authorization.professionalId,
      authorizationNumbers: [],
      ceiling: '0.00',
      approvedSoFar: '0.00',
      waiting: '0.00',
    };
    summary.ceiling = money(toCents(summary.ceiling) + ceilingCents);
    if (authorization.authorizationNumber) {
      summary.authorizationNumbers.push(authorization.authorizationNumber);
    }
    byProfessional.set(authorization.professionalId, summary);
  }
  for (const summary of byProfessional.values()) {
    const own = invoices.filter((row) => summary.professionalId === null || row.professionalId === summary.professionalId);
    let approved = 0;
    for (const row of own.filter((r) => r.statusCode === APPROVED_INVOICE_STATUS_CODE)) {
      // eslint-disable-next-line no-await-in-loop
      approved += await approvedCents(db, row.invoiceId);
    }
    summary.approvedSoFar = money(approved);
    summary.waiting = money(own.filter((r) => r.statusCode !== APPROVED_INVOICE_STATUS_CODE).reduce((sum, r) => sum + toCents(r.submittedTotal), 0));
  }
  return [...byProfessional.values()];
}
