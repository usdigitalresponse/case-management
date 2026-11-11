// Each professional's limit on a case (model/rules.yaml apply_preauthorization_limit) and what is approved
// and waiting. "Approved so far" sums signed-off invoices, not allocation draws (../../MAPPING.md).
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { inIds } from '../db/inIds';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { requireReviewPermission } from './reviewAccess';
import {
  caseTable,
  invoice,
  invoiceApprovalChain,
  invoiceLine,
  invoiceStatuses,
  preauthorization,
  preauthorizationDecision,
  preauthorizationOutcomes,
  preauthorizationStatuses,
} from '../db/schema';
import { approvedTotal, latestRoundNumber, loadRecordedDecisionsByChain } from './reviewRounds';
import { fromCents as money, toCents } from './money';
import { APPROVED_INVOICE_STATUS_CODE, IN_REVIEW_INVOICE_STATUS_CODES } from './invoiceStatusCodes';
import { loadThresholdTable, thresholdBoundProfessionalIds, thresholdFrom, type ThresholdTable } from './preauthorizationThresholds';

export interface PreauthorizationSummary {
  professionalId: string | null;
  // 'threshold': no pre-authorization; ceiling is the county's threshold.
  source: 'preauthorized' | 'threshold';
  preauthorizationId: string | null;
  authorizationNumbers: string[];
  ceiling: string;
  approvedSoFar: string;
  waiting: string;
}

// Each invoice's approved total from its latest finished round; 0 without one.
async function approvedCentsByInvoice(db: DatabaseOrTransaction, invoiceIds: string[]): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) {
    return new Map();
  }
  const [chains, lineCounts] = await Promise.all([
    db
      .select({ invoiceId: invoiceApprovalChain.invoiceId, chainId: invoiceApprovalChain.invoiceApprovalChainId })
      .from(invoiceApprovalChain)
      .where(and(inIds(invoiceApprovalChain.invoiceId, invoiceIds), isNull(invoiceApprovalChain.supersededAt))),
    db
      .select({ invoiceId: invoiceLine.invoiceId, lines: count() })
      .from(invoiceLine)
      .where(inIds(invoiceLine.invoiceId, invoiceIds))
      .groupBy(invoiceLine.invoiceId),
  ]);
  const decisions = await loadRecordedDecisionsByChain(db, chains.map((chain) => chain.chainId));
  const linesOf = new Map(lineCounts.map((row) => [row.invoiceId, row.lines]));
  const cents = new Map(invoiceIds.map((invoiceId) => [invoiceId, 0]));
  for (const { invoiceId, chainId } of chains) {
    const recorded = decisions.get(chainId) ?? [];
    cents.set(invoiceId, toCents(approvedTotal(recorded, latestRoundNumber(recorded, linesOf.get(invoiceId) ?? 0))));
  }
  return cents;
}

// The pre-authorized hourly rate per professional on a case (null key: a
// pre-authorization for the whole case), from each approved
// pre-authorization's latest decision that set one.
export async function loadRateLimits(db: DatabaseOrTransaction, caseId: string | null): Promise<Map<string | null, string>> {
  return caseId === null ? new Map() : (await loadRateLimitsByCase(db, [caseId])).get(caseId)!;
}

// The same for several cases; every one asked for has an entry.
export async function loadRateLimitsByCase(db: DatabaseOrTransaction, caseIds: string[]): Promise<Map<string, Map<string | null, string>>> {
  const byCase = new Map(caseIds.map((caseId) => [caseId, new Map<string | null, string>()]));
  if (caseIds.length === 0) {
    return byCase;
  }
  const rows = await db
    .select({
      caseId: preauthorization.caseId,
      preauthorizationId: preauthorization.preauthorizationId,
      professionalId: preauthorization.professionalId,
      rate: preauthorizationDecision.approvedHourlyRate,
      outcomeCode: preauthorizationOutcomes.code,
    })
    .from(preauthorization)
    .innerJoin(preauthorizationStatuses, eq(preauthorization.statusId, preauthorizationStatuses.id))
    .innerJoin(preauthorizationDecision, eq(preauthorizationDecision.preauthorizationId, preauthorization.preauthorizationId))
    .innerJoin(preauthorizationOutcomes, eq(preauthorizationDecision.outcomeId, preauthorizationOutcomes.id))
    .where(and(inIds(preauthorization.caseId, caseIds), eq(preauthorizationStatuses.code, 'approved')))
    .orderBy(desc(preauthorizationDecision.sequenceNumber));
  const seen = new Set<string>();
  for (const row of rows) {
    // Only each pre-authorization's latest decision counts.
    if (seen.has(row.preauthorizationId)) continue;
    seen.add(row.preauthorizationId);
    const limits = byCase.get(row.caseId)!;
    if (row.rate !== null && row.outcomeCode !== 'denied' && !limits.has(row.professionalId)) {
      limits.set(row.professionalId, row.rate);
    }
  }
  return byCase;
}

export interface RateLimit {
  rate: string;
  source: 'case' | 'preauthorized' | 'configured';
}

// The rate a time line is checked against: a case rate a reviewer set, else
// the pre-authorized rate for the professional whose work it is, else the
// case's, else the configured rate.
export function rateLimitFor(
  line: { timekeeperProfessionalId: string | null; configuredRate: string | null; rateSource: string | null },
  invoiceProfessionalId: string | null,
  limits: Map<string | null, string>,
): RateLimit | null {
  if (line.configuredRate !== null && (line.rateSource === 'case_person' || line.rateSource === 'case_kind')) {
    return { rate: line.configuredRate, source: 'case' };
  }
  const professionalId = line.timekeeperProfessionalId ?? invoiceProfessionalId;
  const preauthorized = (professionalId ? limits.get(professionalId) : undefined) ?? limits.get(null);
  if (preauthorized) return { rate: preauthorized, source: 'preauthorized' };
  return line.configuredRate === null ? null : { rate: line.configuredRate, source: 'configured' };
}

export async function loadPreauthorizationSummaries(
  db: DatabaseOrTransaction,
  caseId: string,
  // Summarized even with no invoices yet.
  alsoProfessionalIds: string[] = [],
  // Loaded once by callers summarizing many cases.
  thresholds?: ThresholdTable,
): Promise<PreauthorizationSummary[]> {
  return (await loadPreauthorizationSummariesByCase(db, [caseId], alsoProfessionalIds, thresholds)).get(caseId)!;
}

// The same for several cases, in a fixed number of queries; every one asked for has an entry.
export async function loadPreauthorizationSummariesByCase(
  db: DatabaseOrTransaction,
  caseIds: string[],
  alsoProfessionalIds: string[] = [],
  thresholds?: ThresholdTable,
): Promise<Map<string, PreauthorizationSummary[]>> {
  const summaries = new Map(caseIds.map((caseId) => [caseId, new Map<string | null, PreauthorizationSummary>()]));
  if (caseIds.length === 0) {
    return new Map();
  }
  const [authorizations, invoices] = await Promise.all([
    db
      .select({
        caseId: preauthorization.caseId,
        preauthorizationId: preauthorization.preauthorizationId,
        professionalId: preauthorization.professionalId,
        authorizationNumber: preauthorization.authorizationNumber,
      })
      .from(preauthorization)
      .innerJoin(preauthorizationStatuses, eq(preauthorization.statusId, preauthorizationStatuses.id))
      .where(and(inIds(preauthorization.caseId, caseIds), eq(preauthorizationStatuses.code, 'approved')))
      .orderBy(asc(preauthorization.requestedAt)),
    db
      .select({
        caseId: invoice.caseId,
        invoiceId: invoice.invoiceId,
        professionalId: invoice.professionalId,
        statusCode: invoiceStatuses.code,
        submittedTotal: invoice.submittedTotal,
      })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(and(inIds(invoice.caseId, caseIds), inArray(invoiceStatuses.code, [APPROVED_INVOICE_STATUS_CODE, ...IN_REVIEW_INVOICE_STATUS_CODES]))),
  ]);
  const decisions =
    authorizations.length === 0
      ? []
      : await db
          .select({
            preauthorizationId: preauthorizationDecision.preauthorizationId,
            outcomeCode: preauthorizationOutcomes.code,
            approvedAmount: preauthorizationDecision.approvedAmount,
          })
          .from(preauthorizationDecision)
          .innerJoin(preauthorizationOutcomes, eq(preauthorizationDecision.outcomeId, preauthorizationOutcomes.id))
          .where(inIds(preauthorizationDecision.preauthorizationId, authorizations.map((row) => row.preauthorizationId)))
          .orderBy(desc(preauthorizationDecision.sequenceNumber));
  // Ceilings replace each other; the latest decision sets it.
  const latestDecision = new Map<string, (typeof decisions)[number]>();
  for (const decision of decisions) {
    if (!latestDecision.has(decision.preauthorizationId)) latestDecision.set(decision.preauthorizationId, decision);
  }
  const invoicesOf = new Map<string, typeof invoices>(caseIds.map((caseId) => [caseId, []]));
  for (const row of invoices) {
    invoicesOf.get(row.caseId!)!.push(row);
  }

  for (const authorization of authorizations) {
    const byProfessional = summaries.get(authorization.caseId)!;
    const latest = latestDecision.get(authorization.preauthorizationId);
    const ceilingCents = latest && latest.outcomeCode !== 'denied' ? toCents(latest.approvedAmount) : 0;
    const summary = byProfessional.get(authorization.professionalId) ?? {
      professionalId: authorization.professionalId,
      source: 'preauthorized' as const,
      preauthorizationId: authorization.preauthorizationId,
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

  // A whole-case pre-authorization covers providers with none of their own.
  const unauthorizedOf = new Map<string, string[]>();
  for (const [caseId, byProfessional] of summaries) {
    if (byProfessional.has(null)) continue;
    const unauthorized = [
      ...new Set([...invoicesOf.get(caseId)!.flatMap((row) => (row.professionalId ? [row.professionalId] : [])), ...alsoProfessionalIds]),
    ].filter((id) => !byProfessional.has(id));
    if (unauthorized.length > 0) unauthorizedOf.set(caseId, unauthorized);
  }
  if (unauthorizedOf.size > 0) {
    const [bound, table, caseRows] = await Promise.all([
      thresholdBoundProfessionalIds(db, [...new Set([...unauthorizedOf.values()].flat())]),
      thresholds ?? loadThresholdTable(db),
      db.select({ caseId: caseTable.caseId, countyId: caseTable.countyId }).from(caseTable).where(inIds(caseTable.caseId, [...unauthorizedOf.keys()])),
    ]);
    const countyOf = new Map(caseRows.map((row) => [row.caseId, row.countyId]));
    for (const [caseId, unauthorized] of unauthorizedOf) {
      const threshold = thresholdFrom(table, countyOf.get(caseId) ?? null);
      for (const professionalId of unauthorized) {
        if (!threshold || !bound.has(professionalId)) continue;
        summaries.get(caseId)!.set(professionalId, {
          professionalId,
          source: 'threshold',
          preauthorizationId: null,
          authorizationNumbers: [],
          ceiling: threshold.amount,
          approvedSoFar: '0.00',
          waiting: '0.00',
        });
      }
    }
  }

  const ownOf = (caseId: string, summary: PreauthorizationSummary) =>
    invoicesOf.get(caseId)!.filter((row) => summary.professionalId === null || row.professionalId === summary.professionalId);
  const approvedIds = new Set<string>();
  for (const [caseId, byProfessional] of summaries) {
    for (const summary of byProfessional.values()) {
      for (const row of ownOf(caseId, summary)) {
        if (row.statusCode === APPROVED_INVOICE_STATUS_CODE) approvedIds.add(row.invoiceId);
      }
    }
  }
  const approvedCents = await approvedCentsByInvoice(db, [...approvedIds]);
  const result = new Map<string, PreauthorizationSummary[]>();
  for (const [caseId, byProfessional] of summaries) {
    for (const summary of byProfessional.values()) {
      const own = ownOf(caseId, summary);
      summary.approvedSoFar = money(own.filter((r) => r.statusCode === APPROVED_INVOICE_STATUS_CODE).reduce((sum, r) => sum + approvedCents.get(r.invoiceId)!, 0));
      summary.waiting = money(own.filter((r) => r.statusCode !== APPROVED_INVOICE_STATUS_CODE).reduce((sum, r) => sum + toCents(r.submittedTotal), 0));
    }
    result.set(caseId, [...byProfessional.values()]);
  }
  return result;
}

// Their own limit, else the whole case's.
export function summaryForProfessional(summaries: PreauthorizationSummary[], professionalId: string | null): PreauthorizationSummary | null {
  return (
    (professionalId ? summaries.find((summary) => summary.professionalId === professionalId) : undefined) ??
    summaries.find((summary) => summary.professionalId === null) ??
    null
  );
}

const preauthorizedAmountSchema = z.object({
  // Null: for the whole case.
  professionalId: z.uuid().nullable(),
  amount: z.coerce.number().positive('Enter an amount above zero.').max(10_000_000),
  // Kept with the first amount only.
  authorizationNumber: z.string().trim().max(100).optional(),
});

// For one person, or null for the whole case (model/rules.yaml preserve_authorization_decisions).
export async function setPreauthorizedAmount(db: Database, actorUserAccountId: string, caseId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(caseId).success) {
    throw new NotFoundError('Case not found.');
  }
  const parsed = preauthorizedAmountSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const { preauthorizationId } = await recordCeilingInTx(tx, actorUserAccountId, {
      caseId,
      professionalId: input.professionalId,
      amount: input.amount.toFixed(2),
      authorizationNumber: input.authorizationNumber || null,
    });
    return { preauthorizationId };
  });
}

// First an approved decision, then revised ones replacing the ceiling; never below what is signed off.
export async function recordCeilingInTx(
  tx: Transaction,
  actorUserAccountId: string,
  input: {
    caseId: string;
    professionalId: string | null;
    amount: string;
    hourlyRate?: string | null;
    authorizationNumber?: string | null;
    requestedAt?: Date;
    reason?: string | null;
  },
): Promise<{ preauthorizationId: string; decisionId: string }> {
  const [locked] = await tx.select({ caseId: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, input.caseId)).for('update');
  if (!locked) {
    throw new NotFoundError('Case not found.');
  }
  // Approximation of committed draws (see the header): what is signed off so far.
  const current = (await loadPreauthorizationSummaries(tx, input.caseId)).find((summary) => summary.professionalId === input.professionalId);
  if (current && toCents(current.approvedSoFar) > toCents(input.amount)) {
    throw new ValidationError({ amount: `${money(toCents(current.approvedSoFar))} is already approved. Enter at least that.` });
  }
  const approvedStatusId = await getReferenceId(tx, preauthorizationStatuses, 'approved');
  const [existing] = await tx
    .select({ preauthorizationId: preauthorization.preauthorizationId })
    .from(preauthorization)
    .where(
      and(
        eq(preauthorization.caseId, input.caseId),
        eq(preauthorization.statusId, approvedStatusId),
        input.professionalId ? eq(preauthorization.professionalId, input.professionalId) : isNull(preauthorization.professionalId),
      ),
    )
    .orderBy(desc(preauthorization.requestedAt))
    .limit(1);
  const now = new Date();
  if (!existing) {
    const created = firstRow(
      await tx
        .insert(preauthorization)
        .values({
          caseId: input.caseId,
          professionalId: input.professionalId,
          statusId: approvedStatusId,
          requestedAmount: input.amount,
          requestedAt: input.requestedAt ?? now,
          authorizationNumber: input.authorizationNumber ?? null,
        })
        .returning({ preauthorizationId: preauthorization.preauthorizationId }),
    );
    const decision = firstRow(
      await tx
        .insert(preauthorizationDecision)
        .values({
          preauthorizationId: created.preauthorizationId,
          sequenceNumber: 1,
          outcomeId: await getReferenceId(tx, preauthorizationOutcomes, 'approved'),
          approvedAmount: input.amount,
          approvedHourlyRate: input.hourlyRate ?? null,
          effectiveAt: now,
          decidedAt: now,
          decidedByUserAccountId: actorUserAccountId,
          reason: input.reason ?? null,
        })
        .returning({ id: preauthorizationDecision.preauthorizationDecisionId }),
    );
    return { preauthorizationId: created.preauthorizationId, decisionId: decision.id };
  }
  const [latest] = await tx
    .select({ sequenceNumber: preauthorizationDecision.sequenceNumber, approvedHourlyRate: preauthorizationDecision.approvedHourlyRate })
    .from(preauthorizationDecision)
    .where(eq(preauthorizationDecision.preauthorizationId, existing.preauthorizationId))
    .orderBy(desc(preauthorizationDecision.sequenceNumber))
    .limit(1);
  const decision = firstRow(
    await tx
      .insert(preauthorizationDecision)
      .values({
        preauthorizationId: existing.preauthorizationId,
        sequenceNumber: (latest?.sequenceNumber ?? 0) + 1,
        outcomeId: await getReferenceId(tx, preauthorizationOutcomes, 'revised'),
        approvedAmount: input.amount,
        // Undefined keeps the earlier rate; null clears it.
        approvedHourlyRate: input.hourlyRate === undefined ? (latest?.approvedHourlyRate ?? null) : input.hourlyRate,
        effectiveAt: now,
        decidedAt: now,
        decidedByUserAccountId: actorUserAccountId,
        reason: input.reason ?? null,
      })
      .returning({ id: preauthorizationDecision.preauthorizationDecisionId }),
  );
  return { preauthorizationId: existing.preauthorizationId, decisionId: decision.id };
}

// Approved and waiting, plus this invoice unless already counted, past the limit. Never blocks review.
export function overPreauthorization(summary: PreauthorizationSummary | null, invoiceTotal: string, alreadyCounted: boolean): boolean {
  if (!summary) return false;
  return toCents(summary.approvedSoFar) + toCents(summary.waiting) + (alreadyCounted ? 0 : toCents(invoiceTotal)) > toCents(summary.ceiling);
}
