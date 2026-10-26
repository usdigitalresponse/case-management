// The staff queue: invoices waiting on review or sign-off, or finished, with
// who has each, how long it has waited and what needs care.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  invoice,
  invoiceApprovalChain,
  invoiceLine,
  invoiceLineWorkingDecision,
  invoiceStatuses,
} from '../db/schema';
import { loadCaseNumbers, selectInvoiceHeaders } from './invoiceDetail';
import { latestRoundNumber, loadRecordedDecisions, signOffProgress } from './reviewRounds';
import { loadAssignments } from './reviewAssignment';
import { getReviewSettings } from './reviewSettings';
import { workingDaysBetween } from './workingDays';
import { loadRateLimits, rateLimitFor } from './preauthorizations';
import type { RuleFinding } from './billingRules';
import {
  APPROVED_INVOICE_STATUS_CODE,
  AWAITING_SIGN_OFF_INVOICE_STATUS_CODE,
  IN_REVIEW_INVOICE_STATUS_CODES,
  REJECTED_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';

// open: waiting on review or sign-off; finished: approved or rejected;
// all: every submitted invoice (one case's list).
export type QueueView = 'open' | 'finished' | 'all';

export interface QueueFlag {
  kind: 'rate' | 'arithmetic' | 'rule' | 'no_case';
  message: string;
}

function money(value: string | number): string {
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function listReviewQueue(db: Database, view: QueueView, options: { caseId?: string; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const finished = [APPROVED_INVOICE_STATUS_CODE, REJECTED_INVOICE_STATUS_CODE];
  const statusCodes =
    view === 'open' ? IN_REVIEW_INVOICE_STATUS_CODES : view === 'finished' ? finished : [...IN_REVIEW_INVOICE_STATUS_CODES, ...finished];
  const headers = await selectInvoiceHeaders(db).where(
    and(inArray(invoiceStatuses.code, statusCodes), ...(options.caseId ? [eq(invoice.caseId, options.caseId)] : [])),
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
        timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      })
      .from(invoiceLine)
      .where(inArray(invoiceLine.invoiceId, invoiceIds)),
    db
      .select({
        invoiceId: invoiceApprovalChain.invoiceId,
        chainId: invoiceApprovalChain.invoiceApprovalChainId,
        snapshot: invoiceApprovalChain.submissionSnapshot,
      })
      .from(invoiceApprovalChain)
      .where(and(inArray(invoiceApprovalChain.invoiceId, invoiceIds), isNull(invoiceApprovalChain.supersededAt))),
    loadCaseNumbers(db, [...new Set(headers.map((header) => header.caseId))]),
    getReviewSettings(db),
  ]);
  const working = await db
    .select({ chainId: invoiceLineWorkingDecision.invoiceApprovalChainId })
    .from(invoiceLineWorkingDecision)
    .where(inArray(invoiceLineWorkingDecision.invoiceApprovalChainId, chains.map((chain) => chain.chainId)));
  const caseIds = [...new Set(headers.map((header) => header.caseId))];
  const rateLimits = new Map(await Promise.all(caseIds.map(async (caseId) => [caseId, await loadRateLimits(db, caseId)] as const)));

  const rows = await Promise.all(
    headers.map(async (header) => {
      const own = lines.filter((line) => line.invoiceId === header.invoiceId);
      const chain = chains.find((row) => row.invoiceId === header.invoiceId);
      const [assignments, recorded] = await Promise.all([
        loadAssignments(db, header.invoiceId),
        chain ? loadRecordedDecisions(db, chain.chainId) : Promise.resolve([]),
      ]);
      const round = latestRoundNumber(recorded, own.length);
      const inReview = IN_REVIEW_INVOICE_STATUS_CODES.includes(header.statusCode ?? '') && header.statusCode !== AWAITING_SIGN_OFF_INVOICE_STATUS_CODE;
      const decided = inReview ? working.filter((row) => row.chainId === chain?.chainId).length : round === null ? 0 : own.length;
      const approvedCents = recorded
        .filter((decision) => decision.sequenceNumber === round && decision.invoiceLineId)
        .reduce((sum, decision) => sum + Math.round(Number(decision.approvedAmount ?? 0) * 100), 0);

      const flags: QueueFlag[] = [];
      if (header.caseId === null) {
        flags.push({ kind: 'no_case', message: 'No case: the provider and case are not tracked in this system' });
      }
      // Time lines (the ones with a configured rate) billed above their limit.
      const limits = rateLimits.get(header.caseId) ?? new Map();
      const overRate = own
        .filter((line) => line.configuredRate !== null && line.billedRate !== null)
        .map((line) => ({ line, limit: rateLimitFor(line, header.professionalId, limits) }))
        .find(({ line, limit }) => limit && Number(line.billedRate) > Number(limit.rate));
      if (overRate?.limit) {
        flags.push({
          kind: 'rate',
          message: `Rate check: bills ${money(overRate.line.billedRate as string)} an hour, ${overRate.limit.source === 'preauthorized' ? 'pre-authorized' : 'configured'} ${money(overRate.limit.rate)}`,
        });
      }
      const mismatch = own.find(
        (line) =>
          line.quantity !== null &&
          line.unitRate !== null &&
          line.statedAmount !== null &&
          Math.round(Number(line.quantity) * Number(line.unitRate) * 100) !== Math.round(Number(line.statedAmount) * 100),
      );
      if (mismatch) {
        flags.push({
          kind: 'arithmetic',
          message: `One line does not add up: ${mismatch.quantity} × ${money(mismatch.unitRate as string)} is not ${money(mismatch.statedAmount as string)}`,
        });
      }
      const findings =
        (chain?.snapshot as { billing_rules?: { findings?: RuleFinding[] } } | null)?.billing_rules?.findings ?? [];
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
        // From the latest finished round; null until one is finished.
        approvedTotal: round === null ? null : (approvedCents / 100).toFixed(2),
        reviewer: assignments.reviewer,
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
  return { invoices: rows, waitingAlertWorkingDays: settings.waitingAlertWorkingDays };
}
