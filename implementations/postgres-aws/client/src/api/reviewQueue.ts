import { request } from './http';
import { batchParams, type Batch } from './batches';
import type { CountyChoice, SavedCounty } from './cases';
import type { ProposedCase, ProposedProvider } from './myInvoices';

// One invoice's header, as the staff queue and the portal both show it.
export type CaseChoice = 'existing' | 'new' | 'none';

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
  // Which case it is for: existing, new or none (not for one case); null while unanswered.
  caseChoice: CaseChoice | null;
  // On a draft: the existing case it is matched to, or the client of the case added, when sent.
  chosenCaseId: string | null;
  newCaseClientName: string | null;
  // Its case's county, only when it differs from the invoice's own.
  caseCountyDisplayName: string | null;
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
  kind: 'rate' | 'rate_changed' | 'arithmetic' | 'rule' | 'no_case' | 'county' | 'preauthorization';
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
  // The one looking may throw it away (the server's canDiscardEntry).
  discardable: boolean;
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

export type QueueView = 'open' | 'finished' | 'lines_decided' | 'all';
// A person's: 'waiting' (in review) and 'done' (decided).
export type QueueShow = 'all' | 'mine' | 'unassigned' | 'flagged' | 'month' | 'sign_off' | 'decided' | 'completed' | 'approved' | 'waiting' | 'done';
// search: exact matches before close ones, each newest first.
export type QueueSort = 'waiting' | 'newest' | 'finished' | 'search';

// open: waiting on review or sign-off; finished: decided; lines_decided: also awaiting sign-off;
// all: every sent invoice. q: matching a name or case number, close matches included;
// day: with an item that date; county: a county's id, 'none' or 'grouped'.
export interface QueueRequest {
  view: QueueView;
  show?: QueueShow;
  sort?: QueueSort;
  county?: string;
  q?: string;
  professionalId?: string;
  caseId?: string;
  day?: string;
  // The filters whose counts the page shows.
  counts?: QueueShow[];
}

export interface CountyCount {
  countyId: string | null;
  displayName: string | null;
  count: number;
}

export interface LateInvoice {
  invoiceId: string;
  professionalDisplayName: string | null;
  submittedByDisplayName: string | null;
  submittedTotal: string;
  holderDisplayName: string | null;
  workingDaysWaiting: number;
}

// The whole queue's, with the first batch.
export interface QueueSummary {
  // Those asked for; null where only the rows themselves can tell (flags).
  counts: Partial<Record<QueueShow, number | null>>;
  // With the filter applied; null when it is flags.
  counties: CountyCount[] | null;
  late: LateInvoice[];
  // Invoices the person looking is still entering.
  entering: ReviewQueueItem[];
  waitingAlertWorkingDays: number;
  // With q, in the county chosen: matches totalled apart, and every close one to warn about.
  search?: {
    exact: Totals;
    close: Totals & {
      invoices: Array<{
        invoiceId: string;
        professionalDisplayName: string | null;
        submittedByDisplayName: string | null;
        caseNumber: string | null;
        periodStart: string | null;
        periodEnd: string | null;
      }>;
    };
    people: number;
  };
  // With professionalId, whatever q is: every invoice of theirs, those sent this year, and those waiting now.
  person?: { total: number; thisYear: Totals & { approved: string }; waiting: Totals };
}

export interface Totals {
  count: number;
  requested: string;
}

// limit: rows a batch, up to the server's most (200); its usual 50 when left out.
export function listReviewQueue(query: QueueRequest, after: string | null, limit?: number): Promise<Batch<ReviewQueueItem, QueueSummary>> {
  const params = new URLSearchParams({ view: query.view });
  if (limit) params.set('limit', String(limit));
  for (const name of ['show', 'sort', 'county', 'professionalId', 'caseId', 'day'] as const) {
    const value = query[name];
    if (value) params.set(name, value);
  }
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.counts?.length) params.set('counts', query.counts.join(','));
  return request(`/api/invoices?${batchParams(params, after)}`);
}

// The sidebar's: invoices to review, and those waiting on the person looking.
export function queueCounts(): Promise<{ all: number; mine: number }> {
  return request('/api/invoices/counts');
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

export type OverviewStep = 'no_reviewer' | 'being_reviewed' | 'sign_off' | 'not_completed';

export interface OverviewInvoice {
  invoiceId: string;
  senderDisplayName: string | null;
  caseNumber: string | null;
  submittedTotal: string;
}

export interface InvoiceChange {
  invoiceId: string;
  senderDisplayName: string | null;
  caseNumber: string | null;
  periodStart: string | null;
  what: string;
  when: string;
  by: string | null;
}

export interface InvoiceOverview {
  steps: Array<{ step: OverviewStep; count: number; invoices: OverviewInvoice[] }>;
  changes: InvoiceChange[];
}

export function getInvoiceOverview(): Promise<InvoiceOverview> {
  return request('/api/invoices/overview');
}
