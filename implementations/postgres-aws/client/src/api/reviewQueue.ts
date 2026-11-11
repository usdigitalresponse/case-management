import { request } from './http';
import type { CountyChoice, SavedCounty } from './cases';
import type { ProposedCase, ProposedProvider } from './myInvoices';

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
