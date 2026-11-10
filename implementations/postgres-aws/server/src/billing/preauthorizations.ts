// How much of each professional's pre-authorization on a case is used:
// the ceiling, approved so far and waiting for a decision. Reviewers check
// this by hand without it. Approximation (../../MAPPING.md): "approved so
// far" sums signed-off invoices for that professional on the case, not
// invoice_authorization_allocation draws, which are not built.
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
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
import { approvedTotal, latestRoundNumber, loadRecordedDecisions } from './reviewRounds';
import { fromCents as money, toCents } from './money';
import { APPROVED_INVOICE_STATUS_CODE, IN_REVIEW_INVOICE_STATUS_CODES } from './invoiceStatusCodes';

export interface PreauthorizationSummary {
  professionalId: string | null;
  authorizationNumbers: string[];
  ceiling: string;
  approvedSoFar: string;
  waiting: string;
}


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
  return toCents(approvedTotal(decisions, latestRoundNumber(decisions, lines.length)));
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

const preauthorizedAmountSchema = z.object({
  // Null: for the whole case.
  professionalId: z.uuid().nullable(),
  amount: z.coerce.number().positive('Enter an amount above zero.').max(10_000_000),
  // Kept with the first amount only.
  authorizationNumber: z.string().trim().max(100).optional(),
});

// Any staff member enters or changes a case's pre-authorized amount, for one
// person or the whole case (model/rules.yaml preserve_authorization_decisions):
// the first is an approved pre-authorization, a change a new revised
// decision keeping its hourly rate. Earlier decisions stay.
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
    const [locked] = await tx.select({ caseId: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, caseId)).for('update');
    if (!locked) {
      throw new NotFoundError('Case not found.');
    }
    // Approximation of committed draws (see the header): what is signed off so far.
    const current = (await loadPreauthorizationSummaries(tx, caseId)).find((summary) => summary.professionalId === input.professionalId);
    if (current && toCents(current.approvedSoFar) > toCents(input.amount.toFixed(2))) {
      throw new ValidationError({ amount: `${money(toCents(current.approvedSoFar))} is already approved. Enter at least that.` });
    }
    const approvedStatusId = await getReferenceId(tx, preauthorizationStatuses, 'approved');
    const [existing] = await tx
      .select({ preauthorizationId: preauthorization.preauthorizationId })
      .from(preauthorization)
      .where(
        and(
          eq(preauthorization.caseId, caseId),
          eq(preauthorization.statusId, approvedStatusId),
          input.professionalId ? eq(preauthorization.professionalId, input.professionalId) : isNull(preauthorization.professionalId),
        ),
      )
      .orderBy(desc(preauthorization.requestedAt))
      .limit(1);
    const now = new Date();
    const amount = input.amount.toFixed(2);
    if (!existing) {
      const created = firstRow(
        await tx
          .insert(preauthorization)
          .values({
            caseId,
            professionalId: input.professionalId,
            statusId: approvedStatusId,
            requestedAmount: amount,
            requestedAt: now,
            authorizationNumber: input.authorizationNumber || null,
          })
          .returning({ preauthorizationId: preauthorization.preauthorizationId }),
      );
      await tx.insert(preauthorizationDecision).values({
        preauthorizationId: created.preauthorizationId,
        sequenceNumber: 1,
        outcomeId: await getReferenceId(tx, preauthorizationOutcomes, 'approved'),
        approvedAmount: amount,
        effectiveAt: now,
        decidedAt: now,
        decidedByUserAccountId: actorUserAccountId,
      });
      return { preauthorizationId: created.preauthorizationId };
    }
    const [latest] = await tx
      .select({ sequenceNumber: preauthorizationDecision.sequenceNumber, approvedHourlyRate: preauthorizationDecision.approvedHourlyRate })
      .from(preauthorizationDecision)
      .where(eq(preauthorizationDecision.preauthorizationId, existing.preauthorizationId))
      .orderBy(desc(preauthorizationDecision.sequenceNumber))
      .limit(1);
    await tx.insert(preauthorizationDecision).values({
      preauthorizationId: existing.preauthorizationId,
      sequenceNumber: (latest?.sequenceNumber ?? 0) + 1,
      outcomeId: await getReferenceId(tx, preauthorizationOutcomes, 'revised'),
      approvedAmount: amount,
      approvedHourlyRate: latest?.approvedHourlyRate ?? null,
      effectiveAt: now,
      decidedAt: now,
      decidedByUserAccountId: actorUserAccountId,
    });
    return { preauthorizationId: existing.preauthorizationId };
  });
}

// Whether this invoice takes its person (or the case) over the pre-authorized
// amount: what is approved so far plus this invoice's request, while it isn't
// signed off yet. Reviewers may still approve or reject it.
export function overPreauthorization(summary: PreauthorizationSummary | null, invoiceTotal: string, alreadyCounted: boolean): boolean {
  if (!summary) return false;
  return toCents(summary.approvedSoFar) + (alreadyCounted ? 0 : toCents(invoiceTotal)) > toCents(summary.ceiling);
}
