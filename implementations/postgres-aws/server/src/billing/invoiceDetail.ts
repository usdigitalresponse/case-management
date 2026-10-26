// One invoice with its lines and decisions, shared by staff review, the
// portal and exports. Callers check access first. Submitters see recorded
// decisions only: never working decisions or internal comments
// (model/rules.yaml limit_review_comment_visibility).
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction } from '../db/client';
import {
  caseIdentifier,
  caseTable,
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalOutcomes,
  invoiceDecisionReasons,
  invoiceLine,
  invoiceLineTypes,
  invoiceLineWorkingDecision,
  invoiceStatuses,
  invoiceReceiptChannels,
  person,
  professional,
  professionalKinds,
  timeEntry,
  userAccount,
} from '../db/schema';
import { evaluateBillingRules, type RuleFinding } from './billingRules';
import { loadRateLimits, rateLimitFor, type RateLimit } from './preauthorizations';
import { approvedTotal, latestRoundNumber, loadRecordedDecisions, signOffProgress, type RecordedDecision } from './reviewRounds';
import { AWAITING_SIGN_OFF_INVOICE_STATUS_CODE } from './invoiceStatusCodes';
import { loadAssignments, SIGN_OFF_STEP_TYPE_CODE, type InvoiceAssignments } from './reviewAssignment';

export type Audience = 'staff' | 'submitter';

export function selectInvoiceHeaders(db: DatabaseOrTransaction) {
  return db
    .select({
      invoiceId: invoice.invoiceId,
      caseId: invoice.caseId,
      caseClientDisplayName: person.displayName,
      caseExternalReference: caseTable.externalReference,
      professionalId: invoice.professionalId,
      professionalDisplayName: professional.displayName,
      professionalKindDisplayName: professionalKinds.displayName,
      submittedByUserAccountId: invoice.submittedByUserAccountId,
      submittedByDisplayName: userAccount.displayName,
      statusId: invoice.statusId,
      statusCode: invoiceStatuses.code,
      statusDisplayName: invoiceStatuses.displayName,
      submittedAt: invoice.submittedAt,
      submittedTotal: invoice.submittedTotal,
      currencyCode: invoice.currencyCode,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      // Set when staff entered an invoice received outside the system.
      receivedViaDisplayName: invoiceReceiptChannels.displayName,
      receivedOn: invoice.receivedOn,
    })
    .from(invoice)
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .leftJoin(userAccount, eq(invoice.submittedByUserAccountId, userAccount.userAccountId))
    .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(invoiceReceiptChannels, eq(invoice.receivedViaId, invoiceReceiptChannels.id));
}

export type InvoiceHeader = Awaited<ReturnType<typeof selectInvoiceHeaders>>[number];

// A case's number is its primary identifier, else its external reference;
// its other identifiers (such as court numbers) are listed after it.
// Invoices with no case (null) have no numbers.
export async function loadCaseNumbers(db: DatabaseOrTransaction, maybeCaseIds: Array<string | null>) {
  const result = new Map<string | null, { caseNumber: string | null; otherNumbers: string[] }>();
  const caseIds = maybeCaseIds.filter((caseId): caseId is string => caseId !== null);
  if (caseIds.length === 0) {
    return result;
  }
  const [cases, identifiers] = await Promise.all([
    db
      .select({ caseId: caseTable.caseId, externalReference: caseTable.externalReference })
      .from(caseTable)
      .where(inArray(caseTable.caseId, caseIds)),
    db
      .select({ caseId: caseIdentifier.caseId, value: caseIdentifier.value, isPrimary: caseIdentifier.isPrimary })
      .from(caseIdentifier)
      .where(inArray(caseIdentifier.caseId, caseIds)),
  ]);
  for (const row of cases) {
    const own = identifiers.filter((identifier) => identifier.caseId === row.caseId);
    const primary = own.find((identifier) => identifier.isPrimary)?.value ?? row.externalReference;
    result.set(row.caseId, {
      caseNumber: primary,
      otherNumbers: own.map((identifier) => identifier.value).filter((value) => value !== primary),
    });
  }
  return result;
}

async function selectLines(db: DatabaseOrTransaction, invoiceId: string) {
  return db
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      amount: invoiceLine.amount,
      serviceDate: invoiceLine.serviceDate,
      serviceDateInferred: invoiceLine.serviceDateInferred,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitRate: invoiceLine.unitRate,
      statedAmount: invoiceLine.statedAmount,
      billedRate: invoiceLine.billedRate,
      configuredRate: invoiceLine.configuredRate,
      timekeeperLabel: invoiceLine.timekeeperLabel,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      timekeeperDisplayName: professional.displayName,
      taskCode: invoiceLine.taskCode,
      activityCode: invoiceLine.activityCode,
      expenseCode: invoiceLine.expenseCode,
      expenseTypeCode: expenseTypes.code,
      tripOrigin: invoiceLine.tripOrigin,
      tripDestination: invoiceLine.tripDestination,
      roundTrip: invoiceLine.roundTrip,
      routeDistance: invoiceLine.routeDistance,
      routeCheckedAt: invoiceLine.routeCheckedAt,
      sourceTimeEntryId: invoiceLine.sourceTimeEntryId,
      sourceActivityOn: timeEntry.activityOn,
      sourceDurationHours: timeEntry.durationHours,
      sourceDescription: timeEntry.description,
    })
    .from(invoiceLine)
    .leftJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
    .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
    .leftJoin(professional, eq(invoiceLine.timekeeperProfessionalId, professional.professionalId))
    .where(eq(invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(invoiceLine.serviceDate), asc(timeEntry.activityOn), asc(invoiceLine.invoiceLineId));
}

// approved_in_part is shown, not stored: an approval below the request.
export type DecisionOutcomeCode = 'approved' | 'approved_in_part' | 'rejected';
const OUTCOME_LABELS: Record<DecisionOutcomeCode, string> = {
  approved: 'Approved',
  approved_in_part: 'Approved in part',
  rejected: 'Rejected',
};

function lineOutcome(outcomeCode: string, approvedAmount: string | null, requested: string): DecisionOutcomeCode {
  if (outcomeCode === 'rejected') {
    return 'rejected';
  }
  return approvedAmount !== null && Number(approvedAmount) < Number(requested) ? 'approved_in_part' : 'approved';
}

export interface LineDecisionView {
  outcomeCode: DecisionOutcomeCode;
  outcomeDisplayName: string;
  approvedAmount: string | null;
  approvedQuantity: string | null;
  approvedRate: string | null;
  reasonCode: string | null;
  reasonDisplayName: string | null;
  note: string | null;
  decidedByDisplayName: string | null;
  decidedAt: Date;
}

export interface PastDecisionView extends LineDecisionView {
  round: number;
}

type LineRow = Awaited<ReturnType<typeof selectLines>>[number];

export type InvoiceDetailLine = LineRow & {
  // The rate check's limit for a time line: the pre-authorized rate, else
  // the configured one (./preauthorizations.ts rateLimitFor).
  rateLimit: string | null;
  rateLimitSource: RateLimit['source'] | null;
  // The latest recorded round's decision, flattened (also in decision).
  decisionOutcomeCode: DecisionOutcomeCode | null;
  decisionOutcomeDisplayName: string | null;
  decisionApprovedAmount: string | null;
  decisionReason: string | null;
  decidedByDisplayName: string | null;
  decidedAt: Date | null;
  decision: LineDecisionView | null;
  // Earlier recorded rounds, oldest first.
  history: PastDecisionView[];
  // Staff only: the reviewer's decision in the round in progress.
  working: LineDecisionView | null;
};

export interface SignOffView {
  displayName: string | null;
  outcomeCode: string;
  // Staff only (internal_only).
  comment: string | null;
  decidedAt: Date;
}

export interface SubmissionAttempt {
  invoiceApprovalChainId: string;
  submittedAt: Date;
}

export interface InvoiceDetail {
  invoice: InvoiceHeader;
  caseNumber: string | null;
  otherCaseNumbers: string[];
  lines: InvoiceDetailLine[];
  // Null for drafts.
  submissionAttempt: SubmissionAttempt | null;
  // As submitted for the current attempt; live for a draft.
  ruleFindings: RuleFinding[];
  // The latest recorded round, if any.
  round: number | null;
  approvedTotal: string | null;
  signOffs: SignOffView[];
  // Staff only.
  assignments: InvoiceAssignments | null;
  // Staff only: who signs off next, and whether sign-off of the latest
  // round has started (which ends reopening it).
  nextSignOff: { userAccountId: string; displayName: string } | null;
  signOffStarted: boolean;
}

async function displayNames(db: DatabaseOrTransaction, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: userAccount.userAccountId, name: userAccount.displayName })
    .from(userAccount)
    .where(inArray(userAccount.userAccountId, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function loadInvoiceDetail(
  db: Database,
  invoiceId: string,
  audience: Audience = 'submitter',
): Promise<InvoiceDetail | undefined> {
  const [header] = await selectInvoiceHeaders(db).where(eq(invoice.invoiceId, invoiceId));
  if (!header) {
    return undefined;
  }
  const [lineRows, [attempt], caseNumbers, rateLimits, assignments] = await Promise.all([
    selectLines(db, invoiceId),
    db
      .select({
        invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId,
        submittedAt: invoiceApprovalChain.createdAt,
        snapshot: invoiceApprovalChain.submissionSnapshot,
      })
      .from(invoiceApprovalChain)
      .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt))),
    loadCaseNumbers(db, [header.caseId]),
    loadRateLimits(db, header.caseId),
    audience === 'staff' ? loadAssignments(db, invoiceId) : null,
  ]);
  const [recorded, working, ruleFindings] = await Promise.all([
    attempt ? loadRecordedDecisions(db, attempt.invoiceApprovalChainId) : ([] as RecordedDecision[]),
    attempt && audience === 'staff'
      ? db
          .select({
            invoiceLineId: invoiceLineWorkingDecision.invoiceLineId,
            outcomeCode: invoiceApprovalOutcomes.code,
            approvedAmount: invoiceLineWorkingDecision.approvedAmount,
            approvedQuantity: invoiceLineWorkingDecision.approvedQuantity,
            approvedRate: invoiceLineWorkingDecision.approvedRate,
            reasonCode: invoiceDecisionReasons.code,
            reasonDisplayName: invoiceDecisionReasons.displayName,
            note: invoiceLineWorkingDecision.note,
            decidedByUserAccountId: invoiceLineWorkingDecision.decidedByUserAccountId,
            decidedAt: invoiceLineWorkingDecision.decidedAt,
          })
          .from(invoiceLineWorkingDecision)
          .innerJoin(invoiceApprovalOutcomes, eq(invoiceLineWorkingDecision.outcomeId, invoiceApprovalOutcomes.id))
          .leftJoin(invoiceDecisionReasons, eq(invoiceLineWorkingDecision.reasonCodeId, invoiceDecisionReasons.id))
          .where(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, attempt.invoiceApprovalChainId))
      : [],
    attempt
      ? ((attempt.snapshot as { billing_rules?: { findings?: RuleFinding[] } } | null)?.billing_rules?.findings ?? [])
      : evaluateBillingRules(db, invoiceId),
  ]);
  const names = await displayNames(db, [
    ...recorded.map((decision) => decision.decidedByUserAccountId),
    ...working.map((decision) => decision.decidedByUserAccountId),
  ]);

  const round = latestRoundNumber(recorded, lineRows.length);
  const view = (
    decision: {
      outcomeCode: string;
      approvedAmount: string | null;
      approvedQuantity: string | null;
      approvedRate: string | null;
      reasonCode: string | null;
      reasonDisplayName: string | null;
      decidedByUserAccountId: string;
      decidedAt: Date;
    },
    note: string | null,
    requested: string,
  ): LineDecisionView => {
    const outcomeCode = lineOutcome(decision.outcomeCode, decision.approvedAmount, requested);
    return {
      outcomeCode,
      outcomeDisplayName: OUTCOME_LABELS[outcomeCode],
      approvedAmount: outcomeCode === 'rejected' ? null : decision.approvedAmount,
      approvedQuantity: decision.approvedQuantity,
      approvedRate: decision.approvedRate,
      reasonCode: decision.reasonCode,
      reasonDisplayName: decision.reasonDisplayName,
      note,
      decidedByDisplayName: names.get(decision.decidedByUserAccountId) ?? null,
      decidedAt: decision.decidedAt,
    };
  };

  // Sign-off decisions have no line and are grouped under null.
  const recordedFor = new Map<string | null, RecordedDecision[]>();
  for (const decision of recorded) {
    recordedFor.set(decision.invoiceLineId, [...(recordedFor.get(decision.invoiceLineId) ?? []), decision]);
  }
  const workingFor = new Map(working.map((row) => [row.invoiceLineId, row]));
  const lines: InvoiceDetailLine[] = lineRows.map((line) => {
    const lineDecisions = recordedFor.get(line.invoiceLineId) ?? [];
    const latest = round === null ? undefined : lineDecisions.find((decision) => decision.sequenceNumber === round);
    const decision = latest ? view(latest, latest.reason, line.amount) : null;
    const history = lineDecisions
      .filter((past) => round !== null && past.sequenceNumber < round)
      .map((past) => ({ ...view(past, past.reason, line.amount), round: past.sequenceNumber }));
    const own = workingFor.get(line.invoiceLineId);
    const limit = line.lineTypeCode === 'time' ? rateLimitFor(line, header.professionalId, rateLimits) : null;
    return {
      ...line,
      rateLimit: limit?.rate ?? null,
      rateLimitSource: limit?.source ?? null,
      decisionOutcomeCode: decision?.outcomeCode ?? null,
      decisionOutcomeDisplayName: decision?.outcomeDisplayName ?? null,
      decisionApprovedAmount: decision?.approvedAmount ?? null,
      decisionReason: decision ? [decision.reasonDisplayName, decision.note].filter(Boolean).join('. ') || null : null,
      decidedByDisplayName: decision?.decidedByDisplayName ?? null,
      decidedAt: decision?.decidedAt ?? null,
      decision,
      history,
      working: own ? view(own, own.note, line.amount) : null,
    };
  });

  const signOffs = recorded
    .filter((decision) => decision.stepCode === SIGN_OFF_STEP_TYPE_CODE)
    .map((decision) => ({
      displayName: names.get(decision.decidedByUserAccountId) ?? null,
      outcomeCode: decision.outcomeCode,
      comment: audience === 'staff' || !decision.internalOnly ? decision.reason : null,
      decidedAt: decision.decidedAt,
    }));
  const numbers = caseNumbers.get(header.caseId);
  const progress = signOffProgress(recorded, round, assignments?.signOff ?? []);
  const awaitingSignOff = header.statusCode === AWAITING_SIGN_OFF_INVOICE_STATUS_CODE;
  return {
    invoice: header,
    caseNumber: numbers?.caseNumber ?? null,
    otherCaseNumbers: numbers?.otherNumbers ?? [],
    lines,
    submissionAttempt: attempt ? { invoiceApprovalChainId: attempt.invoiceApprovalChainId, submittedAt: attempt.submittedAt } : null,
    ruleFindings,
    round,
    approvedTotal: approvedTotal(recorded, round),
    signOffs,
    assignments,
    nextSignOff: awaitingSignOff && progress.next ? { userAccountId: progress.next.userAccountId, displayName: progress.next.displayName } : null,
    signOffStarted: awaitingSignOff && progress.started,
  };
}
