import { request } from './http';
import type { CaseRate, CountyChoice, PreauthorizationSummary, RateSource, RateType, SavedCounty } from './cases';
import type { RuleFinding } from './settings';
import type { DraftInvoiceContent, FileSource, InvoiceDetailsInput, InvoiceReceipt, OverrunExplanation, SenderChoice, SubmitterChanges } from './myInvoices';
import type { ImportPreview } from './invoiceImports';
import type { AssignedPerson, QueuedInvoice } from './reviewQueue';
import type { TimeLogCheck } from './timeLog';

// approved_in_part is an approval below the requested amount.
export type DecisionOutcome = 'approved' | 'approved_in_part' | 'rejected';

export interface LineDecision {
  outcomeCode: DecisionOutcome;
  outcomeDisplayName: string;
  approvedAmount: string | null;
  approvedQuantity: string | null;
  approvedRate: string | null;
  reasonCode: string | null;
  reasonDisplayName: string | null;
  note: string | null;
  // Staff only.
  timeLogOverride: string | null;
  decidedByDisplayName: string | null;
  decidedAt: string;
}

// Decision fields are null until the line is reviewed.
export interface InvoiceReviewLine {
  invoiceLineId: string;
  // invoice_line_types code: 'time', 'expense' (including mileage) or 'service' (other).
  lineTypeCode: string | null;
  amount: string;
  // Supplier-stated detail; when absent, the linked time entry's values apply.
  serviceDate: string | null;
  description: string | null;
  quantity: string | null;
  // As stated on an imported file; a time line is billed at it.
  unitRate: string | null;
  statedAmount: string | null;
  // The rate a time or mileage line is billed at.
  billedRate: string | null;
  // Time and mileage lines: the default rate, and where it came from.
  configuredRate: string | null;
  rateSource: RateSource | null;
  caseRateId: string | null;
  rateType: RateType | null;
  // Whose rate prices it.
  rateProfessionalId: string | null;
  rateKindId: string | null;
  rateKindDisplayName: string | null;
  // Time lines: what the rate check compares to, a case rate a reviewer set,
  // else the pre-authorized rate when the case has one, else the configured rate.
  rateLimit: string | null;
  rateLimitSource: 'case' | 'preauthorized' | 'configured' | null;
  // 'mileage' on a mileage line; its quantity is the miles claimed.
  expenseTypeCode: string | null;
  // Its trip, shared by that trip's lines, with the trip's route; a time
  // line on a trip is travel time.
  tripId: string | null;
  // 'waiting' on waiting time.
  timeCategory: string | null;
  tripOrigin: string | null;
  tripDestination: string | null;
  roundTrip: boolean;
  // One-way driving miles, once looked up on submission.
  routeDistance: string | null;
  routeCheckedAt: string | null;
  timekeeperLabel: string | null;
  proposedTimekeeperName: string | null;
  proposedTimekeeperEmail: string | null;
  timekeeperProfessionalId: string | null;
  timekeeperDisplayName: string | null;
  taskCode: string | null;
  activityCode: string | null;
  expenseCode: string | null;
  sourceTimeEntryId: string | null;
  // The imported file's line or row it was read from; null if added.
  sourceLocation: string | null;
  sourceActivityOn: string | null;
  sourceDurationHours: string | null;
  sourceDescription: string | null;
  // The latest finished round's decision, flattened.
  decisionOutcomeCode: DecisionOutcome | null;
  decisionOutcomeDisplayName: string | null;
  decisionApprovedAmount: string | null;
  decisionReason: string | null;
  decidedByDisplayName: string | null;
  decidedAt: string | null;
  decision: LineDecision | null;
  // Earlier finished rounds, oldest first.
  history: Array<LineDecision & { round: number }>;
  // Staff only: the decision in the round in progress.
  working: LineDecision | null;
}

export interface SignOff {
  displayName: string | null;
  outcomeCode: string;
  // Staff only.
  comment: string | null;
  decidedAt: string;
}

export interface ReviewQuestion {
  invoiceReviewQuestionId: string;
  invoiceLineId: string;
  question: string;
  // Staff only.
  askedByDisplayName: string | null;
  askedAt: string;
  answer: string | null;
  // Staff only.
  answeredByDisplayName: string | null;
  answeredAt: string | null;
}

export const MAX_QUESTION_LENGTH = 500;

export interface InvoiceReview {
  invoice: QueuedInvoice;
  // This professional's pre-authorization on the case, if there is one.
  preauthorization: PreauthorizationSummary | null;
  // This invoice takes its person, or the case, over their limit.
  overPreauthorized: boolean;
  // Staff and the sender only.
  overrunExplanations: OverrunExplanation[];
  caseNumber: string | null;
  otherCaseNumbers: string[];
  lines: InvoiceReviewLine[];
  ruleFindings: RuleFinding[];
  round: number | null;
  approvedTotal: string | null;
  signOffs: SignOff[];
  questions: ReviewQuestion[];
  assignments: { reviewer: AssignedPerson | null; signOff: Array<AssignedPerson & { position: number }> } | null;
  // Staff only, while waiting for sign-off: who signs next, and whether
  // anyone has signed this round (which ends reopening).
  nextSignOff: AssignedPerson | null;
  signOffStarted: boolean;
  fileSource: FileSource | null;
  submitterChanges: SubmitterChanges | null;
  // The sender's hourly rate today.
  approvedRate: string | null;
  caseNumberMatches: { same: number; close: number };
  // Days this invoice claims travel that the same professional's invoices
  // on other cases also do.
  sameDayTravel: Array<{ date: string; otherInvoiceCount: number }>;
  // Entered in review and not yet frozen: its reviewer may still edit lines.
  entryOpen: boolean;
  linesChangedByDisplayName: string | null;
  // Whoever entered it may throw it away.
  discardable: boolean;
  // Whoever entered it also finished its latest round.
  decidedByEnterer: boolean;
  // Whoever sent it, or for a staff upload, whoever billed it; null if unknown.
  senderEmail: string | null;
  // The case time log the reviewer is checking the lines against.
  timeLog: TimeLogCheck | null;
  // Staff only: the case's rates, and those set since this invoice was sent
  // that would now give its lines another default.
  caseRates: CaseRate[];
  caseRatesChangedSinceSent: string[];
  // Staff only: mileage warnings set aside for stops on the way.
  mileageDismissals: MileageDismissal[];
}

export interface MileageDismissal {
  invoiceLineId: string;
  reason: string;
  dismissedByDisplayName: string;
  dismissedAt: string;
}

export function setMileageWarning(invoiceId: string, invoiceLineId: string, input: { dismissed: boolean; reason?: string }): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/lines/${invoiceLineId}/mileage-warning`, { method: 'PUT', body: JSON.stringify(input) });
}

export function getInvoiceForReview(invoiceId: string): Promise<InvoiceReview> {
  return request(`/api/invoices/${invoiceId}`);
}

// The file a request was read from, for staff viewing it beside the lines.
// Staff read it through /api/invoices; anyone who may read the invoice in
// the portal through /api/portal/invoices.
export function getInvoiceFilePreview(invoiceId: string, portal = false): Promise<ImportPreview> {
  return request<ImportPreview>(`${invoiceFileUrl(invoiceId, portal)}/preview`);
}

export function invoiceFileUrl(invoiceId: string, portal = false): string {
  return `/api/${portal ? 'portal/' : ''}invoices/${invoiceId}/file`;
}

export interface LineDecisionInput {
  outcome: DecisionOutcome;
  approvedQuantity?: number;
  approvedRate?: number;
  approvedAmount?: number;
  reasonCode?: string;
  note?: string;
  // Why the billed hours stand although the time log flags the line.
  timeLogOverride?: string;
}

// linesVersion: while its lines are being entered, the version the page
// shows; a decision from an out-of-date page is refused (409 stale_lines).
export function decideInvoiceLine(invoiceId: string, invoiceLineId: string, input: LineDecisionInput, linesVersion?: number): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/lines/${invoiceLineId}/decision`, {
    method: 'PUT',
    body: JSON.stringify({ ...input, linesVersion }),
  });
}

export function undoInvoiceLineDecision(invoiceId: string, invoiceLineId: string, linesVersion?: number): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/lines/${invoiceLineId}/decision`, { method: 'DELETE', body: JSON.stringify({ linesVersion }) });
}

export interface LineRateInput {
  // Null with the case scope: back to the configured rate.
  rate: number | null;
  // The matching lines on this invoice, or the case's default from a date.
  scope: 'matching' | 'case';
  target?: 'person' | 'kind';
  effectiveFrom?: string;
  reasonCode?: string;
  note?: string;
  timeLogOverride?: string;
  // The latest case rate for this person or kind the page showed; a change
  // since is refused (409 case_rate_changed).
  basedOnCaseRateId?: string | null;
}

export function applyLineRate(
  invoiceId: string,
  invoiceLineId: string,
  input: LineRateInput,
  linesVersion?: number,
): Promise<{ decided: number; caseRateId: string | null }> {
  return request(`/api/invoices/${invoiceId}/lines/${invoiceLineId}/rate`, { method: 'POST', body: JSON.stringify({ ...input, linesVersion }) });
}

export function repriceInvoice(invoiceId: string, linesVersion?: number): Promise<{ repriced: number }> {
  return request(`/api/invoices/${invoiceId}/reprice`, { method: 'POST', body: JSON.stringify({ linesVersion }) });
}

// The first round of an invoice entered in review also freezes it.
export function finishReview(invoiceId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/finish`, { method: 'POST' });
}

// linesVersion: the version the page was showing; a save from an
// out-of-date page is refused (409 stale_lines). undecided: lines whose
// decision was undone because they changed.
export function saveEnteredLines(
  invoiceId: string,
  content: DraftInvoiceContent & { linesVersion: number },
  { keepalive = false } = {},
): Promise<{ invoiceId: string; submittedTotal: string; undecided: string[]; linesVersion: number }> {
  return request(`/api/invoices/${invoiceId}/entered-lines`, { method: 'PUT', body: JSON.stringify(content), keepalive });
}

// A reviewer's own draft, continued in their review as an upload would be.
export function enterInReview(invoiceId: string): Promise<{ invoiceId: string }> {
  return request(`/api/invoices/${invoiceId}/enter-in-review`, { method: 'POST' });
}

// How and when it came in, saved as entered (either field alone).
export function setEnteredReceipt(invoiceId: string, receipt: InvoiceReceipt): Promise<{ invoiceId: string }> {
  return request(`/api/invoices/${invoiceId}/entered-receipt`, { method: 'PUT', body: JSON.stringify(receipt) });
}

export function setEnteredCaseNumber(invoiceId: string, caseNumber: string): Promise<{ invoiceId: string; caseNumber: string | null }> {
  return request(`/api/invoices/${invoiceId}/entered-case-number`, { method: 'PUT', body: JSON.stringify({ caseNumber }) });
}

export function setEnteredCounty(invoiceId: string, choice: CountyChoice): Promise<{ invoiceId: string; county: SavedCounty | null }> {
  return request(`/api/invoices/${invoiceId}/entered-county`, { method: 'PUT', body: JSON.stringify(choice) });
}

// Reprices the lines, undoing the decision on each it changes, as a line save does.
export function setEnteredSender(
  invoiceId: string,
  choice: SenderChoice,
  linesVersion: number,
): Promise<{ invoiceId: string; undecided: string[]; linesVersion: number }> {
  return request(`/api/invoices/${invoiceId}/entered-sender`, { method: 'PUT', body: JSON.stringify({ ...choice, linesVersion }) });
}

export function setEnteredDetails(invoiceId: string, details: InvoiceDetailsInput): Promise<{ invoiceId: string }> {
  return request(`/api/invoices/${invoiceId}/entered-details`, { method: 'PUT', body: JSON.stringify(details) });
}

export function reopenReview(invoiceId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/reopen`, { method: 'POST' });
}

export type SignOffOutcome = 'approved' | 'rejected' | 'changes_requested';

export function signOffInvoice(invoiceId: string, input: { outcome: SignOffOutcome; comment?: string }): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/sign-off`, { method: 'POST', body: JSON.stringify(input) });
}

export function markInvoiceCompleted(invoiceId: string): Promise<{ invoiceId: string; completedAt: string }> {
  return request(`/api/invoices/${invoiceId}/complete`, { method: 'POST' });
}

export function askQuestion(
  invoiceId: string,
  input: { question: string; invoiceLineId: string },
): Promise<{ invoiceReviewQuestionId: string; statusCode: string }> {
  return request(`/api/invoices/${invoiceId}/questions`, { method: 'POST', body: JSON.stringify(input) });
}

// Staff answer through /api/invoices (recording a reply received another
// way); the submitter through /api/portal/invoices.
export function answerQuestion(invoiceId: string, questionId: string, answer: string, portal = false): Promise<{ statusCode: string }> {
  return request(`/api/${portal ? 'portal/' : ''}invoices/${invoiceId}/questions/${questionId}/answer`, {
    method: 'POST',
    body: JSON.stringify({ answer }),
  });
}

// forCase, forPerson: also send that case's, or that sender's, new invoices to them.
export function reassignReviewer(
  invoiceId: string,
  input: { userAccountId: string; forCase?: boolean; forPerson?: boolean },
): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/reviewer`, { method: 'PUT', body: JSON.stringify(input) });
}

export function setSignOffApprovers(invoiceId: string, userAccountIds: string[]): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/sign-off-approvers`, { method: 'PUT', body: JSON.stringify({ userAccountIds }) });
}
