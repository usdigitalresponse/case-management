import { batchParams, type Batch } from './batches';
import { request } from './http';
import type { CountyChoice, SavedCounty } from './cases';
import type { MileageRate, RuleFinding } from './settings';
import type { BillingOverlap, InvoiceReviewLine, ReviewQuestion } from './invoiceReview';
import type { QueuedInvoice } from './reviewQueue';
import type { SendStatus } from './intake';
import type { ImportWarning } from './invoiceImports';

export interface InvoiceRecord {
  invoiceId: string;
  // Why staff sent it back, until it's sent again.
  returnedReason: string | null;
  proposedCase: ProposedCase | null;
  // Null while a staff-entered invoice waits on Intake for its case.
  caseId: string | null;
  statusId: string;
  statusCode: string;
  statusDisplayName: string;
  submittedAt: string | null;
  submittedTotal: string;
  periodStart: string | null;
  periodEnd: string | null;
  // Survives a recall, which clears submittedAt.
  lastSubmittedAt: string | null;
  // Whether this user may delete it (server/src/billing/deleteInvoice.ts).
  deletable: boolean;
  caseClientDisplayName: string | null;
  caseExternalReference: string | null;
  professionalDisplayName: string | null;
  submittedByUserAccountId: string | null;
  caseNumber: string | null;
  caseNumberAsTyped: string | null;
  caseNumberCorrected: string | null;
  // A draft read from a file; its lines are unchecked until it is confirmed.
  import: { invoiceImportId: string; statusCode: string } | null;
  // The assigned line reviewer, while in review.
  reviewerDisplayName: string | null;
  // Once decided: what the latest round approved, and lines cut in part or full.
  approvedTotal: string | null;
  cutLineCount: number | null;
  // A draft read from a file: what the submitter changed so far.
  changes: SubmitterChanges | null;
}

export type InvoiceLineType = 'time' | 'expense' | 'mileage' | 'other';

export interface CreateInvoiceLineInput {
  lineType?: InvoiceLineType;
  // Required except on a time line, which the server prices from rates.
  amount?: number;
  // Bill this recorded time; makes the line a time line.
  sourceTimeEntryId?: string;
  serviceDate?: string;
  description?: string;
  quantity?: number;
  // Supplier-stated detail from an imported file; kept as evidence.
  unitRate?: number;
  statedAmount?: number;
  timekeeperLabel?: string;
  taskCode?: string;
  activityCode?: string;
  expenseCode?: string;
  // Whose work the line bills; a delegated invoice defaults it server-side.
  timekeeperProfessionalId?: string;
  // Someone not listed, named instead; staff match them on Intake.
  proposedTimekeeperName?: string;
  proposedTimekeeperEmail?: string;
  // Lines sharing a key are one trip; a time line on one is travel time. A
  // mileage line without one is a trip of its own. Each line on a trip
  // carries its route; a mileage line's quantity is the miles.
  tripKey?: string;
  // A time line off a trip may be waiting time.
  timeCategory?: 'waiting';
  tripOrigin?: string;
  tripDestination?: string;
  roundTrip?: boolean;
  // The imported file's line or row it was read from; carried back on save.
  sourceLocation?: string;
  // The saved line this is, so its decision and questions stay with it.
  invoiceLineId?: string;
}

// Who the signed-in user may bill for on a case: themselves, and anyone
// they act for as an office delegate.
export interface BillableProfessional {
  professionalId: string;
  displayName: string | null;
  // Kept for some people; most have only displayName.
  givenName?: string | null;
  familyName?: string | null;
  isSelf: boolean;
  // Whose rates price their time, e.g. "Attorney"; null if none is set.
  kindDisplayName: string | null;
  // Their hourly rates, oldest first: their kind's, then their own from
  // when one is set.
  rates: ProfessionalRate[];
  // With rates of their own, their mileage rates in place of the general
  // ones; empty otherwise.
  mileageRates?: MileageRate[];
  // Their own travel time rates, in place of the travel time setting.
  travelRates?: ProfessionalRate[];
}

export interface ProfessionalRate {
  hourlyRate: string;
  effectiveFrom: string;
}

// The rate with the latest start on or before the date
// (server/src/billing/professionalRates.ts).
export function rateOn(rates: ProfessionalRate[], date: string): string | undefined {
  let found: string | undefined;
  for (const rate of rates) {
    if (rate.effectiveFrom <= date) {
      found = rate.hourlyRate;
    }
  }
  return found;
}

// With no case (staff, on Intake), every active professional.
export function listBillableProfessionals(caseId: string | null): Promise<{ professionals: BillableProfessional[] }> {
  return request<{ professionals: BillableProfessional[] }>(
    caseId ? `/api/portal/cases/${caseId}/billable-professionals` : '/api/portal/billable-professionals',
  );
}

export interface DraftInvoiceContent {
  periodStart?: string;
  periodEnd?: string;
  lines: CreateInvoiceLineInput[];
}

// How and when an invoice staff entered was received
// (model/rules.yaml authorize_staff_invoice_entry), and whether staff chose
// to review it without a case (match_invoice_to_case).
export interface InvoiceReceipt {
  receivedVia?: string;
  receivedOn?: string;
  withoutCase?: boolean;
  // A submitter sending their own confirms it is true and correct.
  attested?: boolean;
  // Filed under whom it is from: needs a typed case number, and goes to
  // review without a case.
  filedByPerson?: boolean;
  overrunExplanation?: string;
}

// What a submitter confirms when sending (server/src/billing/invoiceLifecycle/submit.ts).
export const ATTESTATION_STATEMENT = 'I confirm this invoice is true and correct, and the work was done for this case.';

export function attestationStatement(caseNumberAsTyped: string | null): string {
  return caseNumberAsTyped
    ? `I confirm this invoice is true and correct, and the work was done for case ${caseNumberAsTyped}.`
    : ATTESTATION_STATEMENT;
}

// Where on a PDF page a line was read, as fractions of the page as shown,
// from the top left (server/src/imports/parsedInvoice.ts).
export interface SourceRegion {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// A request's file as read (server/src/imports/invoiceFile.ts): each line as
// first drafted from it, which the submitter's changes are shown against.
export interface FileLine {
  location: string;
  region: SourceRegion | null;
  lineType: string | null;
  serviceDate: string | null;
  description: string | null;
  quantity: number | null;
  unitRate: number | null;
  amount: number | null;
}

export interface FileSource {
  invoiceImportId: string;
  importStatusCode: string;
  fileName: string;
  formatCode: 'ledes_1998b' | 'spreadsheet' | 'document';
  fileAvailable: boolean;
  invoiceNumber: string | null;
  statedTotal: number | null;
  // As the file labels it, and where on a PDF.
  caseNumber: { value: string; region: SourceRegion | null } | null;
  lines: FileLine[];
  warnings: ImportWarning[];
}

export interface SubmitterChanges {
  changedCount: number;
  removedCount: number;
  addedCount: number;
}

export interface CreateInvoiceInput extends DraftInvoiceContent, InvoiceReceipt, CountyChoice {
  // Null: it waits on Intake for its case.
  caseId: string | null;
  // Whose work the invoice bills; defaults to the caller's own profile. Null:
  // chosen when it's matched on Intake.
  professionalId?: string | null;
  // What the submitter knows of a case or provider that isn't listed.
  proposedCase?: ProposedCase;
  proposedProvider?: ProposedProvider;
  // False keeps it as an editable draft; the server defaults to submitting.
  submit?: boolean;
  // Files it by person under this number as typed.
  caseNumber?: string;
  // The number on the sender's own invoice.
  invoiceNumber?: string;
  // A reviewer's goes straight into their own review; its status is then
  // under_review, which callers asking for it don't read.
  enterInReview?: boolean;
}

// Entered because they weren't listed (model/rules.yaml match_invoice_to_case).
export interface ProposedCase {
  clientName: string;
  caseNumber?: string;
  details?: string;
}

export interface ProposedProvider {
  displayName: string;
  email?: string;
  professionalKindId?: string;
}

export function listReceiptChannels(): Promise<{ channels: Array<{ code: string; displayName: string }> }> {
  return request('/api/portal/receipt-channels');
}

// Every invoice this user may read, or one case's.
// list: all but withdrawn and sent-back ones (the summary's needsChanges); current: all but withdrawn;
// all: withdrawn too; case_drafts: drafts with a case.
export interface MyInvoicesRequest {
  caseId?: string;
  show?: 'list' | 'current' | 'all' | 'case_drafts';
}

// Drafts first, then the latest sent, a batch at a time.
export function listMyInvoices(query: MyInvoicesRequest, after: string | null): Promise<Batch<InvoiceRecord, { needsChanges: InvoiceRecord[]; withdrawn: number }>> {
  const params = new URLSearchParams();
  if (query.caseId) params.set('caseId', query.caseId);
  if (query.show) params.set('show', query.show);
  return request(`/api/portal/invoices?${batchParams(params, after)}`);
}

// keepalive: sent as the page closes, so the save outlives it.
export function updateDraftInvoice(
  invoiceId: string,
  content: DraftInvoiceContent,
  { keepalive = false } = {},
): Promise<{ invoiceId: string; submittedTotal: string }> {
  return request<{ invoiceId: string; submittedTotal: string }>(`/api/portal/invoices/${invoiceId}`, {
    method: 'PUT',
    body: JSON.stringify(content),
    keepalive,
  });
}

// The case number as typed, on a draft; empty clears it.
// A draft filed by person, put under one of its sender's cases, or taken off it (null).
export function setDraftCase(invoiceId: string, caseId: string | null): Promise<{ caseId: string | null; caseNumber: string | null }> {
  return request(`/api/portal/invoices/${invoiceId}/case`, { method: 'PUT', body: JSON.stringify({ caseId }) });
}

export function setDraftCaseNumber(invoiceId: string, caseNumber: string): Promise<{ invoiceId: string; caseNumber: string | null }> {
  return request(`/api/portal/invoices/${invoiceId}/case-number`, { method: 'PUT', body: JSON.stringify({ caseNumber }) });
}

export function setDraftCounty(invoiceId: string, choice: CountyChoice): Promise<{ invoiceId: string; county: SavedCounty | null }> {
  return request(`/api/portal/invoices/${invoiceId}/county`, { method: 'PUT', body: JSON.stringify(choice) });
}

// Whom it is from, and for someone with no role a reviewer gives, theirs.
export interface SenderChoice {
  professionalId: string;
  professionalKindId?: string;
}

// Filed by person: its lines priced at the sender's rates.
export function setDraftSender(invoiceId: string, choice: SenderChoice): Promise<{ invoiceId: string }> {
  return request(`/api/portal/invoices/${invoiceId}/sender`, { method: 'PUT', body: JSON.stringify(choice) });
}

// Null clears the period, both days together, or the invoice number.
export interface InvoiceDetailsInput {
  periodStart: string | null;
  periodEnd: string | null;
  invoiceNumber: string | null;
}

export function setDraftDetails(invoiceId: string, details: InvoiceDetailsInput): Promise<{ invoiceId: string }> {
  return request(`/api/portal/invoices/${invoiceId}/details`, { method: 'PUT', body: JSON.stringify(details) });
}

export type InvoiceTransition = 'submit' | 'recall' | 'withdraw';

export function transitionInvoice(
  invoiceId: string,
  transition: InvoiceTransition,
  receipt?: InvoiceReceipt,
  // Sent by staff: why the case they chose couldn't be matched, if it couldn't.
): Promise<{ invoiceId: string; status?: SendStatus; caseProblem?: string | null }> {
  // Sending names the browser's zone, so the emailed receipt's time matches the sender's day.
  const body = transition === 'submit' ? { ...receipt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : receipt;
  return request<{ invoiceId: string; status?: SendStatus; caseProblem?: string | null }>(`/api/portal/invoices/${invoiceId}/${transition}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Reviewer identities aren't sent to the portal; see ../../server/src/routes/portal/invoices.ts.
export type PortalInvoiceLine = Omit<InvoiceReviewLine, 'decidedByDisplayName'>;

export interface PortalInvoice {
  invoice: QueuedInvoice;
  // Comments on approving or rejecting the whole invoice, as line notes are shared.
  decisionComments: Array<{ outcomeCode: string; comment: string; decidedAt: string }>;
  caseNumber: string | null;
  otherCaseNumbers: string[];
  submissionAttempt: { invoiceApprovalChainId: string; submittedAt: string } | null;
  // From the latest finished round of review; null until there is one.
  approvedTotal: string | null;
  lines: PortalInvoiceLine[];
  // Set when the draft came from an uploaded file.
  import: { invoiceImportId: string; statusCode: string } | null;
  // Whether this user may delete it (server/src/billing/deleteInvoice.ts).
  deletable: boolean;
  // Billing rule findings: live for a draft, as submitted otherwise.
  ruleFindings: RuleFinding[];
  fileSource: FileSource | null;
  submitterChanges: SubmitterChanges | null;
  questions: ReviewQuestion[];
  // Whether this user may answer its questions: whoever sent it, or the
  // professional it bills for.
  canAnswer: boolean;
  // Set on a draft that sending would take over its limit.
  overrun: Overrun | null;
  // A draft's possible double billing, among invoices this user may read.
  billingOverlaps: BillingOverlap[];
  overrunExplanations: OverrunExplanation[];
}

export interface Overrun {
  professionalId: string | null;
  limit: string;
  source: 'preauthorized' | 'threshold';
  total: string;
}

export interface OverrunExplanation {
  limit: string;
  source: string;
  total: string;
  explanation: string;
  recordedBy: string | null;
  recordedAt: string;
}

export function deleteInvoice(invoiceId: string): Promise<{ invoiceId: string }> {
  return request<{ invoiceId: string }>(`/api/portal/invoices/${invoiceId}`, { method: 'DELETE' });
}

export function getMyInvoice(invoiceId: string): Promise<PortalInvoice> {
  return request<PortalInvoice>(`/api/portal/invoices/${invoiceId}`);
}

export type InvoiceExportFormat = 'pdf' | 'xlsx';

// A plain link, not a fetch: the browser downloads the attachment with the
// session cookie.
// `omit` takes exportFieldKey values (exportChoices.ts).
export function invoiceExportUrl(scope: 'staff' | 'portal', invoiceId: string, format: InvoiceExportFormat, omit: string[] = []): string {
  const base = scope === 'staff' ? '/api/invoices' : '/api/portal/invoices';
  const query = new URLSearchParams({ format, ...(omit.length > 0 ? { omit: omit.join(',') } : {}) });
  return `${base}/${invoiceId}/export?${query.toString()}`;
}

export function createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; submittedTotal: string; status: SendStatus }> {
  return request<{ invoiceId: string; submittedTotal: string; status: SendStatus }>('/api/portal/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
