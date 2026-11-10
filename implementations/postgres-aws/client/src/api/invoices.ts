import { request } from './http';
import type { CaseRate, CountyChoice, PreauthorizationSummary, RateSource, RateType, SavedCounty } from './cases';
import type { RuleFinding } from './settings';
import type { DraftInvoiceContent, FileSource, ImportPreview, InvoiceDetailsInput, InvoiceReceipt, OverrunExplanation, ProposedCase, ProposedProvider, SenderChoice, SubmitterChanges } from './portal';

// 'awaiting_match': sent, but waiting on Intake for what wasn't listed.
export type SendStatus = 'draft' | 'submitted' | 'awaiting_match';

// Intake: invoices held until they are matched to a case.
export interface IntakeItem {
  invoiceId: string | null;
  invoiceImportId: string | null;
  fileName: string | null;
  // 'sent': sent for matching by its submitter.
  stage: 'reading' | 'unreadable' | 'to_confirm' | 'ready' | 'sent';
  caseId: string | null;
  proposedCase: ProposedCase | null;
  proposedProvider: ProposedProvider | null;
  unlistedTimekeepers: Array<{ invoiceLineId: string; name: string; email: string | null; description: string | null }>;
  professionalId: string | null;
  professionalDisplayName: string | null;
  enteredByUserAccountId: string;
  enteredByDisplayName: string | null;
  enteredAt: string;
  receivedViaDisplayName: string | null;
  receivedOn: string | null;
  submittedTotal: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  suggestedCaseId: string | null;
  suggestedProfessionalId: string | null;
}

export function listInvoiceIntake(): Promise<{ items: IntakeItem[] }> {
  return request('/api/invoices/intake');
}

// addMissing adds the invoice's providers to the case when they aren't on it.
// professionalId: whom it bills, when it was saved without one.
// Back to its submitter's drafts, with what to change (staff only).
export function returnToSubmitter(invoiceId: string, reason: string) {
  return request<{ invoiceId: string }>(`/api/invoices/intake/${invoiceId}/return`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// timekeepers: who did the work, by line, for lines naming someone unlisted.
// released: it went on to review.
export function matchInvoiceToCase(
  invoiceId: string,
  input: { caseId: string; addMissing?: boolean; professionalId?: string; timekeepers?: Record<string, string> },
) {
  return request<{ invoiceId: string; caseId: string; addedProfessionalIds: string[]; released: boolean; releaseProblem?: string }>(`/api/invoices/intake/${invoiceId}/case`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// One invoice's header, as the staff queue and the portal both show it.
export interface QueuedInvoice {
  invoiceId: string;
  // Null while held in intake, or when staff reviewed it without a case.
  caseId: string | null;
  caseClientDisplayName: string | null;
  caseExternalReference: string | null;
  // Null only on a staff draft in intake, chosen when it is matched.
  professionalId: string | null;
  professionalDisplayName: string | null;
  professionalKindDisplayName: string | null;
  submittedByUserAccountId: string;
  // Differs from the professional when an office delegate submitted.
  submittedByDisplayName: string | null;
  statusId: string;
  statusCode: string;
  statusDisplayName: string;
  submittedAt: string | null;
  submittedTotal: string;
  periodStart: string | null;
  periodEnd: string | null;
  // Set when staff entered an invoice received outside the system.
  receivedViaDisplayName: string | null;
  receivedOn: string | null;
  proposedCase: ProposedCase | null;
  proposedProvider: ProposedProvider | null;
  // As the sender typed it; never checked against a list of cases.
  caseNumberAsTyped: string | null;
  // A reviewer's correction, shown in its place.
  caseNumberCorrected: string | null;
  // The number on the sender's own invoice.
  invoiceNumber: string | null;
  // Its own, else its case's.
  countyId: string | null;
  countyDisplayName: string | null;
  // A staff upload, under review from the start.
  enteredInReview: boolean;
  // While its lines are being entered: their version, sent back with each
  // save, and who changed them last, when.
  linesVersion: number;
  linesChangedAt: string | null;
  linesChangedByUserAccountId: string | null;
  returnedReason: string | null;
  // When staff finished telling the sender about the decision.
  completedAt: string | null;
}

export interface AssignedPerson {
  userAccountId: string;
  displayName: string;
}

export interface QueueFlag {
  kind: 'rate' | 'rate_changed' | 'arithmetic' | 'rule' | 'no_case' | 'preauthorization';
  message: string;
}

// The staff review queue (../pages/ReviewQueue.tsx).
export interface ReviewQueueItem extends QueuedInvoice {
  caseNumber: string | null;
  otherCaseNumbers: string[];
  lineCount: number;
  decidedCount: number;
  // Its reviewer is still entering its lines.
  beingEntered: boolean;
  // Questions to the submitter, while the round isn't finished.
  openQuestionCount: number;
  answeredQuestionCount: number;
  // From the latest finished round; null until one is finished.
  approvedTotal: string | null;
  finishedAt: string | null;
  reviewer: AssignedPerson | null;
  // Who must act now: the next approver while it waits for sign-off.
  holder: AssignedPerson | null;
  workingDaysWaiting: number;
  flags: QueueFlag[];
  // Other sent invoices with the same case number, and with a close one.
  caseNumberMatches: { same: number; close: number };
  // How it matched a search's q; null without one.
  match: 'exact' | 'close' | null;
}

// 'all': every sent invoice, for search; professionalId: one person's.
// q: only invoices matching a name or case number, close matches included.
export function listReviewQueue(
  view: 'open' | 'finished' | 'all',
  // day: only invoices with an item on that date.
  options: { professionalId?: string; q?: string; day?: string } = {},
): Promise<{ invoices: ReviewQueueItem[]; waitingAlertWorkingDays: number }> {
  const params = new URLSearchParams({ view });
  if (options.professionalId) params.set('professionalId', options.professionalId);
  if (options.q?.trim()) params.set('q', options.q.trim());
  if (options.day) params.set('day', options.day);
  return request(`/api/invoices?${params}`);
}

// Audited, with the county it replaced.
export function changeInvoiceCounty(invoiceId: string, choice: CountyChoice): Promise<{ invoiceId: string; county: SavedCounty | null }> {
  return request(`/api/invoices/${invoiceId}/county`, { method: 'PUT', body: JSON.stringify(choice) });
}

// The sender's typed number is kept beside it.
export function correctCaseNumber(
  invoiceId: string,
  caseNumber: string,
): Promise<{ invoiceId: string; caseNumberAsTyped: string | null; caseNumberCorrected: string | null }> {
  return request(`/api/invoices/${invoiceId}/case-number`, { method: 'PUT', body: JSON.stringify({ caseNumber }) });
}

export interface ReviewPerson {
  userAccountId: string;
  displayName: string;
  roleName: string;
  reviewsLines: boolean;
  signsOff: boolean;
  waiting: number;
}

export function listReviewPeople(): Promise<{ people: ReviewPerson[] }> {
  return request('/api/invoices/reviewers');
}

// Which list a reason is on: approving in part, rejecting, both, or setting a case rate.
export type ReasonAppliesTo = 'approved_in_part' | 'rejected' | 'both' | 'case_rate';

export interface DecisionReason {
  code: string;
  displayName: string;
  appliesTo: ReasonAppliesTo;
}

export interface DecisionReasonSetting extends DecisionReason {
  reasonId: string;
  active: boolean;
}

export function listDecisionReasonSettings(): Promise<{ reasons: DecisionReasonSetting[] }> {
  return request('/api/settings/decision-reasons');
}

export function addDecisionReason(input: { displayName: string; appliesTo: ReasonAppliesTo }): Promise<DecisionReasonSetting> {
  return request('/api/settings/decision-reasons', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDecisionReason(
  reasonId: string,
  input: Partial<{ displayName: string; appliesTo: ReasonAppliesTo; active: boolean }>,
): Promise<DecisionReasonSetting> {
  return request(`/api/settings/decision-reasons/${reasonId}`, { method: 'PUT', body: JSON.stringify(input) });
}

export interface BillingRecordFilter {
  countyId?: string;
  from?: string;
  to?: string;
  signedOffOnly?: boolean;
  // Column names to leave out.
  omit?: string[];
}

// One row per submitted invoice, for reports outside the tool.
export function billingRecordUrl(format: 'csv' | 'xlsx', filter: BillingRecordFilter = {}): string {
  const params = new URLSearchParams({ format });
  if (filter.countyId) params.set('county', filter.countyId);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.signedOffOnly) params.set('status', 'signed-off');
  if (filter.omit?.length) params.set('omit', filter.omit.join(','));
  return `/api/invoices/billing-record?${params}`;
}

export function listDecisionReasons(): Promise<{ reasons: DecisionReason[] }> {
  return request('/api/invoices/decision-reasons');
}

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

export type TimeLogLineStatus =
  | 'matched'
  | 'linked'
  | 'hours_differ'
  | 'several'
  | 'combined'
  | 'date_differs'
  | 'other_account'
  | 'not_in_log'
  | 'not_checked';

export interface TimeLogEntryCheck {
  key: string;
  entryId: string | null;
  date: string | null;
  hours: number | null;
  worker: string;
  details: string | null;
  start: string | null;
  stop: string | null;
  professionalId: string | null;
  use: 'matched' | 'linked' | 'suggested' | 'unbilled' | 'outside_period' | 'unreadable';
  invoiceLineId: string | null;
  // Stop minus start, when it disagrees with the hours.
  clockHours: number | null;
}

// Column positions, from 0; time spent is in `hours` or else `minutes`.
export type TimeLogColumns = Partial<Record<'date' | 'hours' | 'minutes' | 'worker' | 'details' | 'entryId' | 'start' | 'stop', number>>;

export interface TimeLogCheck {
  fileName: string;
  uploadedAt: string;
  blocksApproval: boolean;
  headers: string[];
  columns: TimeLogColumns;
  period: { start: string; end: string } | null;
  lines: Array<{ invoiceLineId: string; status: TimeLogLineStatus; entryKeys: string[]; loggedHours: number | null; flagged: boolean }>;
  entries: TimeLogEntryCheck[];
  workers: Array<{
    name: string;
    entryCount: number;
    professionalId: string | null;
    notAPerson: boolean;
    automatic: boolean;
    suggestedProfessionalId: string | null;
  }>;
  dailyTotals: Array<{ date: string; professionalId: string; billed: number; logged: number }>;
}

export const NOT_A_PERSON = 'not_a_person';

// Without columns they're found by header; if they can't be, the headers come back.
export function uploadTimeLog(
  invoiceId: string,
  file: File,
  columns?: TimeLogColumns,
): Promise<{ needsColumns: true; headers: string[] } | { needsColumns: false }> {
  const query = columns ? `?${new URLSearchParams({ columns: JSON.stringify(columns) }).toString()}` : '';
  return request(`/api/invoices/${invoiceId}/time-log${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
}

export function setTimeLogColumns(invoiceId: string, columns: TimeLogColumns): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log/columns`, { method: 'PUT', body: JSON.stringify({ columns }) });
}

export function removeTimeLog(invoiceId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log`, { method: 'DELETE' });
}

// match: a professional id, NOT_A_PERSON, or null to undo.
export function setTimeLogWorker(invoiceId: string, name: string, match: string | null): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log/worker`, { method: 'PUT', body: JSON.stringify({ name, match }) });
}

export function linkTimeLogEntries(invoiceId: string, invoiceLineId: string, entryKeys: string[]): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log/lines/${invoiceLineId}`, { method: 'PUT', body: JSON.stringify({ entryKeys }) });
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
