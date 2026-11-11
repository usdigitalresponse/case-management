// The staff queue: invoices waiting on review or sign-off, or finished, with
// who has each, how long it has waited and what needs care.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { inIds } from '../db/inIds';
import type { Database } from '../db/client';
import {
  invoice,
  invoiceApprovalChain,
  invoiceLine,
  invoiceLineWorkingDecision,
  invoiceOverrunExplanation,
  invoiceReviewQuestion,
  invoiceStatuses,
} from '../db/schema';
import { loadCaseNumbers, selectInvoiceHeaders } from './invoiceDetail';
import { approvedTotal, latestRoundNumber, loadRecordedDecisionsByChain, signOffProgress } from './reviewRounds';
import { formatMoney, toCents } from './money';
import { LINE_REVIEW_STEP_TYPE_CODE, loadAssignmentsByInvoice } from './reviewAssignment';
import { canDiscardEntry } from './enterInReview';
import { getReviewSettings } from './reviewSettings';
import { workingDaysBetween } from './workingDays';
import { loadPreauthorizationSummariesByCase, loadRateLimitsByCase, overPreauthorization, rateLimitFor, summaryForProfessional, type RateLimit } from './preauthorizations';
import { evaluateBillingRules, type RuleFinding } from './billingRules';
import { currentCaseNumber, searchMatch } from './caseNumbers';
import { sentCaseNumberCounts } from './caseNumberMatches';
import {
  AWAITING_SIGN_OFF_INVOICE_STATUS_CODE,
  DECIDED_INVOICE_STATUS_CODES,
  IN_REVIEW_INVOICE_STATUS_CODES,
  LINE_REVIEW_STATUS_CODES,
} from './invoiceStatusCodes';

// open: waiting on review or sign-off; finished: approved or rejected;
// all: every submitted invoice (one case's list).
export type QueueView = 'open' | 'finished' | 'all';

const RATE_LIMIT_NAMES: Record<RateLimit['source'], string> = {
  case: 'case rate',
  preauthorized: 'pre-authorized',
  configured: 'approved rate',
};

export interface QueueFlag {
  kind: 'rate' | 'rate_changed' | 'arithmetic' | 'rule' | 'no_case' | 'preauthorization';
  message: string;
}

export async function listReviewQueue(
  db: Database,
  view: QueueView,
  // q: only invoices matching it by name or case number, each with how;
  // day: only invoices with an item on that date.
  // actorUserAccountId: who is looking, for whether they may discard what they are entering.
  options: { caseId?: string; professionalId?: string; q?: string; day?: string; now?: Date; actorUserAccountId?: string } = {},
) {
  const now = options.now ?? new Date();
  const statusCodes =
    view === 'open'
      ? IN_REVIEW_INVOICE_STATUS_CODES
      : view === 'finished'
        ? DECIDED_INVOICE_STATUS_CODES
        : [...IN_REVIEW_INVOICE_STATUS_CODES, ...DECIDED_INVOICE_STATUS_CODES];
  const headers = await selectInvoiceHeaders(db).where(
    and(
      inArray(invoiceStatuses.code, statusCodes),
      ...(options.caseId ? [eq(invoice.caseId, options.caseId)] : []),
      ...(options.professionalId ? [eq(invoice.professionalId, options.professionalId)] : []),
      ...(options.day
        ? [
            inArray(
              invoice.invoiceId,
              db.select({ invoiceId: invoiceLine.invoiceId }).from(invoiceLine).where(eq(invoiceLine.serviceDate, options.day)),
            ),
          ]
        : []),
    ),
  );
  const invoiceIds = headers.map((header) => header.invoiceId);
  if (invoiceIds.length === 0) {
    return { invoices: [], waitingAlertWorkingDays: (await getReviewSettings(db)).waitingAlertWorkingDays };
  }
  const [lines, chains, caseNumbers, settings] = await Promise.all([
    db
      .select({
        invoiceId: invoiceLine.invoiceId,
        invoiceLineId: invoiceLine.invoiceLineId,
        quantity: invoiceLine.quantity,
        unitRate: invoiceLine.unitRate,
        statedAmount: invoiceLine.statedAmount,
        billedRate: invoiceLine.billedRate,
        configuredRate: invoiceLine.configuredRate,
        rateSource: invoiceLine.rateSource,
        expenseTypeId: invoiceLine.expenseTypeId,
        timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      })
      .from(invoiceLine)
      .where(inIds(invoiceLine.invoiceId, invoiceIds)),
    db
      .select({
        invoiceId: invoiceApprovalChain.invoiceId,
        chainId: invoiceApprovalChain.invoiceApprovalChainId,
        snapshot: invoiceApprovalChain.submissionSnapshot,
      })
      .from(invoiceApprovalChain)
      .where(and(inIds(invoiceApprovalChain.invoiceId, invoiceIds), isNull(invoiceApprovalChain.supersededAt))),
    loadCaseNumbers(db, [...new Set(headers.map((header) => header.caseId))]),
    getReviewSettings(db),
  ]);
  const caseIds = [...new Set(headers.map((header) => header.caseId))];
  const [working, rateLimits, questions, preauthorizations, explained] = await Promise.all([
    db
      .select({ chainId: invoiceLineWorkingDecision.invoiceApprovalChainId })
      .from(invoiceLineWorkingDecision)
      .where(inIds(invoiceLineWorkingDecision.invoiceApprovalChainId, chains.map((chain) => chain.chainId))),
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
  ]);
  const explainedInvoiceIds = new Set(explained.map((row) => row.invoiceId));
  const linesFor = new Map<string, typeof lines>();
  for (const line of lines) {
    const own = linesFor.get(line.invoiceId);
    if (own) own.push(line);
    else linesFor.set(line.invoiceId, [line]);
  }
  const questionsFor = new Map<string, typeof questions>();
  for (const question of questions) {
    const own = questionsFor.get(question.invoiceId);
    if (own) own.push(question);
    else questionsFor.set(question.invoiceId, [question]);
  }
  const [assignmentsFor, decisionsFor] = await Promise.all([
    loadAssignmentsByInvoice(db, invoiceIds),
    loadRecordedDecisionsByChain(db, chains.map((chain) => chain.chainId)),
  ]);
  const chainFor = new Map(chains.map((chain) => [chain.invoiceId, chain]));
  const workingCount = new Map<string, number>();
  for (const row of working) {
    workingCount.set(row.chainId, (workingCount.get(row.chainId) ?? 0) + 1);
  }

  const rows = await Promise.all(
    headers.map(async (header) => {
      const own = linesFor.get(header.invoiceId) ?? [];
      const chain = chainFor.get(header.invoiceId);
      const assignments = assignmentsFor.get(header.invoiceId)!;
      const recorded = chain ? (decisionsFor.get(chain.chainId) ?? []) : [];
      const round = latestRoundNumber(recorded, own.length);
      const inLineReview = LINE_REVIEW_STATUS_CODES.includes(header.statusCode ?? '');
      const decided = inLineReview ? (chain ? (workingCount.get(chain.chainId) ?? 0) : 0) : round === null ? 0 : own.length;
      // Until the round is finished, so the reviewer sees answers come back.
      const ownQuestions = inLineReview ? (questionsFor.get(header.invoiceId) ?? []) : [];
      const answeredQuestionCount = ownQuestions.filter((question) => question.answeredAt).length;

      const flags: QueueFlag[] = [];
      if (header.caseId === null && !header.caseNumberAsTyped) {
        flags.push({ kind: 'no_case', message: 'No case: the provider and case are not tracked in this system' });
      }
      // Time lines (priced lines other than mileage) billed above their limit.
      const limits = (header.caseId ? rateLimits.get(header.caseId) : undefined) ?? new Map<string | null, string>();
      const overRate = own
        .filter((line) => line.configuredRate !== null && line.billedRate !== null && line.expenseTypeId === null)
        .map((line) => ({ line, limit: rateLimitFor(line, header.professionalId, limits) }))
        .find(({ line, limit }) => limit && Number(line.billedRate) > Number(limit.rate));
      if (overRate?.limit) {
        flags.push({
          kind: 'rate',
          message: `Rate check: bills ${formatMoney(overRate.line.billedRate as string)} an hour, ${RATE_LIMIT_NAMES[overRate.limit.source]} ${formatMoney(overRate.limit.rate)}`,
        });
      }
      const mismatch = own.find(
        (line) =>
          line.quantity !== null &&
          line.unitRate !== null &&
          line.statedAmount !== null &&
          toCents(Number(line.quantity) * Number(line.unitRate)) !== toCents(line.statedAmount),
      );
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
          Number(decision.approvedRate) !== Number(own.find((line) => line.invoiceLineId === decision.invoiceLineId)?.billedRate),
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
        lineCount: own.length,
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
          options.actorUserAccountId !== undefined &&
          assignments.reviewer?.userAccountId === options.actorUserAccountId &&
          (await canDiscardEntry(db, options.actorUserAccountId, header.invoiceId)),
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
  rows.sort((a, b) => b.workingDaysWaiting - a.workingDaysWaiting || Number(a.submittedAt) - Number(b.submittedAt));
  const matchesOf = await sentCaseNumberCounts(db);
  const q = options.q ?? '';
  return {
    invoices: rows
      .map((row) => ({
        ...row,
        caseNumberMatches: matchesOf(currentCaseNumber(row) ?? row.caseNumber),
        match: q ? searchMatch(q, [row.professionalDisplayName, row.submittedByDisplayName], currentCaseNumber(row) ?? row.caseNumber) : null,
      }))
      .filter((row) => !q || row.match),
    waitingAlertWorkingDays: settings.waitingAlertWorkingDays,
  };
}
