// The staff queue: invoices waiting on review or sign-off, or finished, with
// who has each, how long it has waited and what needs care.
import { and, count, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { withoutCursor } from '../lists/batches';
import { inIds } from '../db/inIds';
import { groupBy } from '../groupBy';
import type { Database } from '../db/client';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceLine,
  invoiceLineWorkingDecision,
  invoiceOverrunExplanation,
  invoiceReviewQuestion,
  invoiceStatuses,
} from '../db/schema';
import { loadCaseNumbers, selectInvoiceHeaders, type InvoiceHeader } from './invoiceDetail';
import { approvedTotal, latestRoundNumber, loadRecordedDecisionsByChain, signOffProgress } from './reviewRounds';
import { formatMoney } from './money';
import { LINE_REVIEW_STEP_TYPE_CODE, loadAssignmentsByInvoice } from './reviewAssignment';
import { canDiscardEntry } from './enterInReview';
import { getReviewSettings } from './reviewSettings';
import { workingDaysBetween } from './workingDays';
import { loadPreauthorizationSummariesByCase, loadRateLimitsByCase, overPreauthorization, rateLimitFor, summaryForProfessional, type RateLimit } from './preauthorizations';
import { evaluateBillingRules, type RuleFinding } from './billingRules';
import { currentCaseNumber, searchMatch, type CaseNumberMatches } from './caseNumbers';
import { sentCaseNumberCounts } from './caseNumberMatches';
import {
  AWAITING_SIGN_OFF_INVOICE_STATUS_CODE,
  DECIDED_INVOICE_STATUS_CODES,
  IN_REVIEW_INVOICE_STATUS_CODES,
  LINE_REVIEW_STATUS_CODES,
} from './invoiceStatusCodes';

// open: waiting on review or sign-off; finished: approved or rejected;
// lines_decided: awaiting sign-off, approved or rejected; all: every submitted invoice.
export type QueueView = 'open' | 'finished' | 'lines_decided' | 'all';

const STATUS_CODES: Record<QueueView, string[]> = {
  open: IN_REVIEW_INVOICE_STATUS_CODES,
  finished: DECIDED_INVOICE_STATUS_CODES,
  lines_decided: [AWAITING_SIGN_OFF_INVOICE_STATUS_CODE, ...DECIDED_INVOICE_STATUS_CODES],
  all: [...IN_REVIEW_INVOICE_STATUS_CODES, ...DECIDED_INVOICE_STATUS_CODES],
};

const RATE_LIMIT_NAMES: Record<RateLimit['source'], string> = {
  case: 'case rate',
  preauthorized: 'pre-authorized',
  configured: 'approved rate',
};

export interface QueueFlag {
  kind: 'rate' | 'rate_changed' | 'arithmetic' | 'rule' | 'no_case' | 'preauthorization';
  message: string;
}

// caseId, professionalId: one case's or person's; day: with an item on that date.
export interface QueueScope {
  caseId?: string;
  professionalId?: string;
  day?: string;
}

export function scopeConditions(db: Database, view: QueueView, scope: QueueScope): SQL[] {
  return [
    inArray(invoice.statusId, db.select({ id: invoiceStatuses.id }).from(invoiceStatuses).where(inArray(invoiceStatuses.code, STATUS_CODES[view]))),
    ...(scope.caseId ? [eq(invoice.caseId, scope.caseId)] : []),
    ...(scope.professionalId ? [eq(invoice.professionalId, scope.professionalId)] : []),
    ...(scope.day
      ? [inArray(invoice.invoiceId, db.select({ invoiceId: invoiceLine.invoiceId }).from(invoiceLine).where(eq(invoiceLine.serviceDate, scope.day)))]
      : []),
  ];
}

// Each invoice's queue row, in the order given: who has it, its progress, how long it has waited and its flags.
// actorUserAccountId: who is looking, for whether they may discard what they are entering.
export async function describeQueue(db: Database, headers: InvoiceHeader[], { now, actorUserAccountId }: { now: Date; actorUserAccountId?: string }) {
  if (headers.length === 0) return [];
  const invoiceIds = headers.map((header) => header.invoiceId);
  const rateChecked = and(isNotNull(invoiceLine.configuredRate), isNotNull(invoiceLine.billedRate), isNull(invoiceLine.expenseTypeId));
  // Postgres rounds the exact product half away from zero, as invoices do; floats can round 151.575 down.
  const doesNotAddUp = sql`round(${invoiceLine.quantity} * ${invoiceLine.unitRate}, 2) <> ${invoiceLine.statedAmount}`;
  // One row per invoice and rate a line is checked against, with its count and highest rate billed.
  const [lineGroups, mismatches, chains, caseNumbers] = await Promise.all([
    db
      .select({
        invoiceId: invoiceLine.invoiceId,
        timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
        configuredRate: invoiceLine.configuredRate,
        rateSource: invoiceLine.rateSource,
        lines: count(),
        billedRate: sql<string | null>`max(${invoiceLine.billedRate}) filter (where ${rateChecked})`,
      })
      .from(invoiceLine)
      .where(inIds(invoiceLine.invoiceId, invoiceIds))
      .groupBy(invoiceLine.invoiceId, invoiceLine.timekeeperProfessionalId, invoiceLine.configuredRate, invoiceLine.rateSource),
    // Each invoice's first line whose stated amount doesn't add up.
    db
      .selectDistinctOn([invoiceLine.invoiceId], {
        invoiceId: invoiceLine.invoiceId,
        quantity: invoiceLine.quantity,
        unitRate: invoiceLine.unitRate,
        statedAmount: invoiceLine.statedAmount,
      })
      .from(invoiceLine)
      .where(and(inIds(invoiceLine.invoiceId, invoiceIds), doesNotAddUp))
      .orderBy(invoiceLine.invoiceId, invoiceLine.position, invoiceLine.invoiceLineId),
    db
      .select({
        invoiceId: invoiceApprovalChain.invoiceId,
        chainId: invoiceApprovalChain.invoiceApprovalChainId,
        snapshot: invoiceApprovalChain.submissionSnapshot,
      })
      .from(invoiceApprovalChain)
      .where(and(inIds(invoiceApprovalChain.invoiceId, invoiceIds), isNull(invoiceApprovalChain.supersededAt))),
    loadCaseNumbers(db, [...new Set(headers.map((header) => header.caseId))]),
  ]);
  const caseIds = [...new Set(headers.map((header) => header.caseId))];
  const chainIds = chains.map((chain) => chain.chainId);
  const [working, rateLimits, questions, preauthorizations, explained, decidedRates] = await Promise.all([
    db
      .select({ chainId: invoiceLineWorkingDecision.invoiceApprovalChainId })
      .from(invoiceLineWorkingDecision)
      .where(inIds(invoiceLineWorkingDecision.invoiceApprovalChainId, chainIds)),
    loadRateLimitsByCase(db, caseIds.filter((caseId): caseId is string => caseId !== null)),
    db
      .select({ invoiceId: invoiceReviewQuestion.invoiceId, answeredAt: invoiceReviewQuestion.answeredAt })
      .from(invoiceReviewQuestion)
      .where(inIds(invoiceReviewQuestion.invoiceId, invoiceIds)),
    loadPreauthorizationSummariesByCase(db, caseIds.filter((caseId): caseId is string => caseId !== null)),
    db
      .selectDistinct({ invoiceId: invoiceOverrunExplanation.invoiceId })
      .from(invoiceOverrunExplanation)
      .where(inIds(invoiceOverrunExplanation.invoiceId, invoiceIds)),
    // Billed rates of lines a reviewer set a rate on, for the changed-rate flag.
    db
      .selectDistinct({ invoiceLineId: invoiceLine.invoiceLineId, billedRate: invoiceLine.billedRate })
      .from(invoiceApprovalDecision)
      .innerJoin(invoiceLine, eq(invoiceLine.invoiceLineId, invoiceApprovalDecision.invoiceLineId))
      .where(and(inIds(invoiceApprovalDecision.invoiceApprovalChainId, chainIds), isNotNull(invoiceApprovalDecision.approvedRate))),
  ]);
  const mismatchOf = new Map(mismatches.map((line) => [line.invoiceId, line]));
  const billedRateOf = new Map(decidedRates.map((line) => [line.invoiceLineId, line.billedRate]));
  const explainedInvoiceIds = new Set(explained.map((row) => row.invoiceId));
  const linesFor = groupBy(lineGroups, (group) => group.invoiceId);
  const questionsFor = groupBy(questions, (question) => question.invoiceId);
  const [assignmentsFor, decisionsFor] = await Promise.all([
    loadAssignmentsByInvoice(db, invoiceIds),
    loadRecordedDecisionsByChain(db, chainIds),
  ]);
  const chainFor = new Map(chains.map((chain) => [chain.invoiceId, chain]));
  const workingCount = new Map<string, number>();
  for (const row of working) {
    workingCount.set(row.chainId, (workingCount.get(row.chainId) ?? 0) + 1);
  }

  const rows = await Promise.all(
    headers.map(async (header) => {
      const own = linesFor.get(header.invoiceId) ?? [];
      const lineCount = own.reduce((sum, group) => sum + group.lines, 0);
      const chain = chainFor.get(header.invoiceId);
      const assignments = assignmentsFor.get(header.invoiceId)!;
      const recorded = chain ? (decisionsFor.get(chain.chainId) ?? []) : [];
      const round = latestRoundNumber(recorded, lineCount);
      const inLineReview = LINE_REVIEW_STATUS_CODES.includes(header.statusCode ?? '');
      const decided = inLineReview ? (chain ? (workingCount.get(chain.chainId) ?? 0) : 0) : round === null ? 0 : lineCount;
      // Until the round is finished, so the reviewer sees answers come back.
      const ownQuestions = inLineReview ? (questionsFor.get(header.invoiceId) ?? []) : [];
      const answeredQuestionCount = ownQuestions.filter((question) => question.answeredAt).length;

      const flags: QueueFlag[] = [];
      if (header.caseId === null && !header.caseNumberAsTyped) {
        flags.push({ kind: 'no_case', message: 'No case: the provider and case are not tracked in this system' });
      }
      // The highest rate on a time line (a priced line other than mileage) billed above its limit.
      const limits = (header.caseId ? rateLimits.get(header.caseId) : undefined) ?? new Map<string | null, string>();
      const overRate = own
        .filter((line) => line.billedRate !== null)
        .map((line) => ({ line, limit: rateLimitFor(line, header.professionalId, limits) }))
        .filter(({ line, limit }) => limit && Number(line.billedRate) > Number(limit.rate))
        .sort((a, b) => Number(b.line.billedRate) - Number(a.line.billedRate) || Number(a.limit!.rate) - Number(b.limit!.rate))[0];
      if (overRate?.limit) {
        flags.push({
          kind: 'rate',
          message: `Rate check: bills ${formatMoney(overRate.line.billedRate as string)} an hour, ${RATE_LIMIT_NAMES[overRate.limit.source]} ${formatMoney(overRate.limit.rate)}`,
        });
      }
      const mismatch = mismatchOf.get(header.invoiceId);
      if (mismatch) {
        flags.push({
          kind: 'arithmetic',
          message: `One line does not add up: ${mismatch.quantity} × ${formatMoney(mismatch.unitRate as string)} is not ${formatMoney(mismatch.statedAmount as string)}`,
        });
      }
      // A reviewer's changed rate is flagged for sign-off.
      const changedRates = recorded.filter(
        (decision) =>
          decision.sequenceNumber === round &&
          decision.approvedRate !== null &&
          Number(decision.approvedRate) !== Number(billedRateOf.get(decision.invoiceLineId!)),
      ).length;
      const preauthorized = header.caseId ? summaryForProfessional(preauthorizations.get(header.caseId) ?? [], header.professionalId) : null;
      if (
        preauthorized &&
        !DECIDED_INVOICE_STATUS_CODES.includes(header.statusCode ?? '') &&
        overPreauthorization(preauthorized, header.submittedTotal, true)
      ) {
        const limit = preauthorized.source === 'threshold' ? 'the threshold' : 'the pre-authorized';
        const unexplained = explainedInvoiceIds.has(header.invoiceId) ? '' : ', not explained';
        flags.push({ kind: 'preauthorization', message: `Over ${limit} ${formatMoney(preauthorized.ceiling)}${unexplained}` });
      }
      if (changedRates > 0) {
        flags.push({ kind: 'rate_changed', message: `Reviewer changed the rate on ${changedRates} ${changedRates === 1 ? 'line' : 'lines'}` });
      }
      const beingEntered = header.enteredInReview && Boolean(chain) && chain?.snapshot === null;
      // As submitted; live while its lines are still being entered.
      const findings = beingEntered
        ? await evaluateBillingRules(db, header.invoiceId)
        : ((chain?.snapshot as { billing_rules?: { findings?: RuleFinding[] } } | null)?.billing_rules?.findings ?? []);
      if (findings.length > 0) {
        flags.push({ kind: 'rule', message: `${findings.length} billing rule ${findings.length === 1 ? 'finding' : 'findings'}` });
      }

      const nextApprover =
        header.statusCode === AWAITING_SIGN_OFF_INVOICE_STATUS_CODE ? signOffProgress(recorded, round, assignments.signOff).next : null;
      const numbers = caseNumbers.get(header.caseId);
      return {
        ...header,
        caseNumber: numbers?.caseNumber ?? null,
        otherCaseNumbers: numbers?.otherNumbers ?? [],
        lineCount,
        decidedCount: decided,
        openQuestionCount: ownQuestions.length - answeredQuestionCount,
        answeredQuestionCount,
        approvedTotal: approvedTotal(recorded, round),
        // When the latest round's line review finished.
        finishedAt:
          round === null
            ? null
            : recorded
                .filter((decision) => decision.sequenceNumber === round && decision.stepCode === LINE_REVIEW_STEP_TYPE_CODE)
                .reduce<Date | null>((latest, decision) => (latest && latest > decision.decidedAt ? latest : decision.decidedAt), null),
        reviewer: assignments.reviewer,
        // Its reviewer is still entering its lines (./enterInReview.ts).
        beingEntered,
        discardable:
          beingEntered &&
          actorUserAccountId !== undefined &&
          assignments.reviewer?.userAccountId === actorUserAccountId &&
          (await canDiscardEntry(db, actorUserAccountId, header.invoiceId)),
        // Who must act now: the next approver while awaiting sign-off.
        holder: nextApprover ?? assignments.reviewer,
        // A staff-entered invoice waits from the day it was received.
        workingDaysWaiting: header.receivedOn
          ? workingDaysBetween(new Date(`${header.receivedOn}T12:00:00Z`), now)
          : header.submittedAt
            ? workingDaysBetween(header.submittedAt, now)
            : 0,
        flags,
      };
    }),
  );
  return rows;
}

export const withMatches = <Row extends Awaited<ReturnType<typeof describeQueue>>[number]>(
  rows: Row[],
  matchesOf: (caseNumber: string | null) => CaseNumberMatches,
  q: string,
) =>
  rows.map((row) => ({
    ...row,
    caseNumberMatches: matchesOf(currentCaseNumber(row) ?? row.caseNumber),
    match: q ? searchMatch(q, [row.professionalDisplayName, row.submittedByDisplayName], currentCaseNumber(row) ?? row.caseNumber) : null,
  }));

export type QueueRow = ReturnType<typeof withMatches>[number];

// Every invoice at once, waiting longest first; q: only those matching it by name or case number, each with how.
export async function listReviewQueue(
  db: Database,
  view: QueueView,
  options: QueueScope & { q?: string; now?: Date; actorUserAccountId?: string } = {},
) {
  const [headers, settings] = await Promise.all([selectInvoiceHeaders(db).where(and(...scopeConditions(db, view, options))), getReviewSettings(db)]);
  const rows = await describeQueue(db, headers.map(withoutCursor), { now: options.now ?? new Date(), actorUserAccountId: options.actorUserAccountId });
  rows.sort((a, b) => b.workingDaysWaiting - a.workingDaysWaiting || Number(a.submittedAt) - Number(b.submittedAt));
  const q = options.q ?? '';
  return {
    invoices: withMatches(rows, rows.length === 0 ? () => ({ same: 0, close: 0 }) : await sentCaseNumberCounts(db), q).filter((row) => !q || row.match),
    waitingAlertWorkingDays: settings.waitingAlertWorkingDays,
  };
}
