// Thin fetch wrapper — no business logic here, only HTTP mechanics. The
// server (../../server/src/routes) owns validation and business rules.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}

export interface AuthenticatedUser {
  userAccountId: string;
  email: string;
  displayName: string;
  authType: 'sso' | 'email-code';
  ssoProvider?: string;
  // From /auth/me only. They show or hide parts of the UI; the server
  // enforces each. isStaff: a staff role, so may enter invoices for others.
  isAdmin?: boolean;
  isStaff?: boolean;
  reviewPermissions?: ReviewPermissions | null;
  // The staff demo sign-in is on, so Settings has demo tools.
  demoMode?: boolean;
}

export interface ReviewPermissions {
  reviewLines: boolean;
  signOff: boolean;
  reassign: boolean;
  changeSettings: boolean;
}

export function getCurrentUser(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/me');
}

// userAccountId: one of listDemoAccounts(); the server's default without it.
export function demoLogin(userAccountId?: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-login', { method: 'POST', body: JSON.stringify({ userAccountId }) });
}

export function externalDemoLogin(userAccountId?: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-login/external', { method: 'POST', body: JSON.stringify({ userAccountId }) });
}

// The seeded synthetic accounts the demo sign-ins may act as.
export interface DemoAccount {
  userAccountId: string;
  displayName: string;
  // The staff role, or the partner's kind of work.
  description: string | null;
}

export function listDemoAccounts(): Promise<{ staff: DemoAccount[]; partners: DemoAccount[] }> {
  return request<{ staff: DemoAccount[]; partners: DemoAccount[] }>('/auth/demo-accounts');
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' });
}

export interface AuthProvider {
  id: string;
  displayName: string;
}

export interface AuthProvidersResponse {
  // Only providers with credentials configured (see ../../server/src/auth/oidcProviders.ts).
  providers: AuthProvider[];
  // Whether the server allows demo sign-in (off in production unless
  // DEMO_LOGIN_ENABLED=true).
  demoLoginEnabled: boolean;
  // Same, for signing in as a demo external partner
  // (EXTERNAL_DEMO_LOGIN_ENABLED).
  externalDemoLoginEnabled: boolean;
}

export function listAuthProviders(): Promise<AuthProvidersResponse> {
  return request<AuthProvidersResponse>('/auth/providers');
}

// Always resolves (the server responds 202 whether or not the email is
// recognized, to avoid revealing which external addresses are allowed in)
// — there is no success/failure branch to handle here beyond a network/5xx
// error.
export function requestSignInCode(email: string): Promise<void> {
  return request<void>('/auth/code/request', { method: 'POST', body: JSON.stringify({ email }) });
}

// 401 if the code is wrong, expired, used or out of tries.
export function verifySignInCode(email: string, code: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/code/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
}

// Mirrors server/src/cases/caseStage.ts's CASE_STAGES; null once a case
// is closed (case.closedOn set) — it has left the working board.
export type CaseStage = 'needs-assignment' | 'represented' | 'billing' | 'closing';

export interface CaseRecord {
  caseId: string;
  clientId: string | null;
  clientDisplayName: string | null;
  countyId: string | null;
  externalReference: string | null;
  caseCategoryId: string | null;
  statusId: string;
  statusDisplayName: string;
  openedOn: string | null;
  closedOn: string | null;
  organizationId: string | null;
  officeId: string | null;
  jurisdictionId: string | null;
  preferredLanguageId: string | null;
  stage: CaseStage | null;
}

export function listCases(): Promise<{ cases: CaseRecord[] }> {
  return request<{ cases: CaseRecord[] }>('/api/cases');
}

export interface CaseParticipant {
  caseParticipantId: string;
  caseId: string;
  personId: string;
  personDisplayName: string | null;
  participantRoleId: string;
  participantRoleDisplayName: string | null;
  affiliationId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface CaseLifecycleEvent {
  caseLifecycleEventId: string;
  caseId: string;
  sequenceNumber: number;
  eventTypeId: string;
  resultingStatusId: string;
  resultingStatusDisplayName: string;
  effectiveAt: string;
  recordedAt: string;
  actorUserAccountId: string;
  reasonId: string | null;
  reasonDetail: string | null;
  referenceNumber: string | null;
  correctsEventId: string | null;
}

export interface CaseIdentifier {
  caseIdentifierId: string;
  caseId: string;
  identifierTypeId: string;
  issuer: string;
  value: string;
  isPrimary: boolean;
}

export interface CaseAssignment {
  caseAssignmentId: string;
  caseId: string;
  professionalId: string;
  professionalDisplayName: string | null;
  assignmentRoleId: string;
  assignmentRoleDisplayName: string | null;
  assignedAt: string;
  endedAt: string | null;
}

export interface CaseDetail {
  case: CaseRecord;
  participants: CaseParticipant[];
  lifecycleEvents: CaseLifecycleEvent[];
  identifiers: CaseIdentifier[];
  assignments: CaseAssignment[];
}

export function getCase(caseId: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}`);
}

export interface PreauthorizationSummary {
  professionalId: string | null;
  authorizationNumbers: string[];
  ceiling: string;
  approvedSoFar: string;
  waiting: string;
}

export interface CaseInvoices {
  invoices: ReviewQueueItem[];
  preauthorizations: PreauthorizationSummary[];
  // Where this case's new invoices go, ahead of the default.
  reviewer: AssignedPerson | null;
  caseNumber: string | null;
  otherCaseNumbers: string[];
}

export function getCaseInvoices(caseId: string): Promise<CaseInvoices> {
  return request<CaseInvoices>(`/api/cases/${caseId}/invoices`);
}

export function setCaseReviewer(caseId: string, userAccountId: string): Promise<AssignedPerson | null> {
  return request(`/api/cases/${caseId}/invoice-reviewer`, { method: 'PUT', body: JSON.stringify({ userAccountId }) });
}

export function createExternalAssignment(caseId: string, professionalId: string): Promise<{ assignment: CaseAssignment }> {
  return request(`/api/cases/${caseId}/external-assignments`, { method: 'POST', body: JSON.stringify({ professionalId }) });
}

export interface StaffAccount {
  userAccountId: string;
  displayName: string;
  email: string;
  active: boolean;
}

export function searchStaff(query: string): Promise<{ staff: StaffAccount[] }> {
  return request<{ staff: StaffAccount[] }>(`/api/staff?q=${encodeURIComponent(query)}`);
}

export function createStaffAssignment(caseId: string, userAccountId: string): Promise<{ assignment: CaseAssignment }> {
  return request<{ assignment: CaseAssignment }>(`/api/cases/${caseId}/staff-assignments`, {
    method: 'POST',
    body: JSON.stringify({ userAccountId }),
  });
}

export interface PersonRecord {
  personId: string;
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  displayName: string;
  dateOfBirth: string | null;
  email: string | null;
}

export function searchPeople(query: string): Promise<{ people: PersonRecord[] }> {
  return request<{ people: PersonRecord[] }>(`/api/people?q=${encodeURIComponent(query)}`);
}

// People who hold the "Client" role on at least one case — the sidebar's
// Clients directory, distinct from searchPeople above (any existing
// person, used to pick one for a new case participant).
export interface ClientRecord {
  personId: string;
  displayName: string;
  email: string | null;
}

export function listClients(query: string): Promise<{ clients: ClientRecord[] }> {
  return request<{ clients: ClientRecord[] }>(`/api/clients?q=${encodeURIComponent(query)}`);
}

// Providers (attorneys, experts and vendors): the sidebar's Providers list.
export interface VendorRecord {
  professionalId: string;
  displayName: string | null;
  active: boolean;
  email: string;
  professionalKindId: string | null;
  professionalKindDisplayName: string | null;
  // Their kind's rates, oldest first.
  rates: ProfessionalRate[];
}

export function listVendors(query: string): Promise<{ professionals: VendorRecord[] }> {
  return request<{ professionals: VendorRecord[] }>(`/api/professionals?q=${encodeURIComponent(query)}`);
}

// --- Settings (administrators change them; staff can read) -----------------

export interface ProfessionalKind {
  professionalKindId: string;
  displayName: string;
  active: boolean;
  // Oldest first.
  rates: ProfessionalRate[];
}

export function listProfessionalKinds(): Promise<{ kinds: ProfessionalKind[] }> {
  return request<{ kinds: ProfessionalKind[] }>('/api/settings/professional-kinds');
}

export function createProfessionalKind(displayName: string): Promise<ProfessionalKind> {
  return request<ProfessionalKind>('/api/settings/professional-kinds', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

// Adds a rate from a date rather than changing an earlier one.
export function addKindRate(professionalKindId: string, input: { hourlyRate: number; effectiveFrom: string }): Promise<ProfessionalRate> {
  return request<ProfessionalRate>(`/api/settings/professional-kinds/${professionalKindId}/rates`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// The deployment's billing rules (server/src/billing/billingRules.ts).
export type RuleEnforcement = 'off' | 'warn' | 'require';
export type BillingRuleCode =
  | 'billing_codes'
  | 'time_increment'
  | 'daily_hour_cap'
  | 'long_entry'
  | 'billing_period'
  | 'mileage_distance';

export interface BillingRule {
  code: BillingRuleCode;
  label: string;
  description: string;
  warnOnly: boolean;
  enforcement: RuleEnforcement;
  parameters: { increment?: number; hours?: number; withinMonth?: boolean; tolerancePercent?: number };
}

// Oldest first (server/src/billing/mileageRates.ts).
export interface MileageRate {
  ratePerMile: string;
  effectiveFrom: string;
}

export function listMileageRates(): Promise<{ rates: MileageRate[] }> {
  return request('/api/settings/mileage-rates');
}

// Adds a rate from a date rather than changing an earlier one.
export function addMileageRate(input: { ratePerMile: number; effectiveFrom: string }): Promise<MileageRate> {
  return request('/api/settings/mileage-rates', { method: 'POST', body: JSON.stringify(input) });
}

export function mileageRateOn(rates: MileageRate[], date: string): string | undefined {
  let found: string | undefined;
  for (const rate of rates) {
    if (rate.effectiveFrom <= date) {
      found = rate.ratePerMile;
    }
  }
  return found;
}

export interface BillingCode {
  billingCodeId: string;
  code: string;
  displayName: string;
  active: boolean;
}

export interface RuleFinding {
  rule: BillingRuleCode;
  enforcement: 'warn' | 'require';
  message: string;
  invoiceLineId?: string;
}

export function getBillingRuleSettings(): Promise<{ rules: BillingRule[]; codes: BillingCode[] }> {
  return request('/api/settings/billing-rules');
}

export function setBillingRule(
  code: BillingRuleCode,
  input: { enforcement: RuleEnforcement; parameters: BillingRule['parameters'] },
): Promise<BillingRule> {
  return request(`/api/settings/billing-rules/${code}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function addBillingCode(input: { code: string; displayName: string }): Promise<BillingCode> {
  return request('/api/settings/billing-codes', { method: 'POST', body: JSON.stringify(input) });
}

export function setBillingCodeActive(billingCodeId: string, active: boolean): Promise<BillingCode> {
  return request(`/api/settings/billing-codes/${billingCodeId}`, { method: 'PUT', body: JSON.stringify({ active }) });
}

// The rules in force, active codes and mileage rates, for firms entering invoices.
export function getPortalBillingRules(): Promise<{
  rules: BillingRule[];
  codes: Array<{ code: string; displayName: string }>;
  mileageRates: MileageRate[];
}> {
  return request('/api/portal/billing-rules');
}

export function setProfessionalKind(professionalId: string, professionalKindId: string | null): Promise<unknown> {
  return request(`/api/professionals/${professionalId}/kind`, {
    method: 'PUT',
    body: JSON.stringify({ professionalKindId }),
  });
}

export interface ReferenceOption {
  id: string;
  code: string;
  displayName: string;
  active: boolean;
}

export interface RoleOption {
  roleId: string;
  displayName: string;
  roleContext: string;
  active: boolean;
}

export interface NamedOption {
  countyId?: string;
  organizationId?: string;
  officeId?: string;
  displayName: string;
  active: boolean;
}

export interface ReferenceData {
  caseStatuses: ReferenceOption[];
  caseCategories: ReferenceOption[];
  jurisdictions: ReferenceOption[];
  languages: ReferenceOption[];
  caseIdentifierTypes: ReferenceOption[];
  participantRoles: RoleOption[];
  counties: NamedOption[];
  organizations: NamedOption[];
  offices: NamedOption[];
}

export function getReferenceData(): Promise<ReferenceData> {
  return request<ReferenceData>('/api/reference-data');
}

export interface CreateCaseIdentifierInput {
  identifierTypeId: string;
  issuer: string;
  value: string;
  isPrimary?: boolean;
}

export interface CreateCaseInput {
  requestId: string;
  personId: string;
  participantRoleId: string;
  statusId: string;
  effectiveAt: string;
  countyId?: string;
  caseCategoryId?: string;
  organizationId?: string;
  officeId?: string;
  jurisdictionId?: string;
  preferredLanguageId?: string;
  identifier?: CreateCaseIdentifierInput;
}

export interface CreateCaseResult {
  caseId: string;
  caseParticipantId: string;
  caseLifecycleEventId: string;
  caseIdentifierId: string | null;
}

export interface ValidationErrorBody {
  error: 'validation_error';
  fieldErrors: Record<string, string>;
}

export function isValidationErrorBody(body: unknown): body is ValidationErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'validation_error'
  );
}

export function createCase(input: CreateCaseInput): Promise<CreateCaseResult> {
  return request<CreateCaseResult>('/api/cases', { method: 'POST', body: JSON.stringify(input) });
}

// --- External portal (view/log time, submit invoices) ---------------------

export interface MyCaseRecord {
  caseId: string;
  statusId: string;
  statusDisplayName: string;
  externalReference: string | null;
  // The primary case identifier, else the external reference.
  caseNumber: string | null;
  clientDisplayName: string | null;
  assignedAt: string;
  assignedProfessionalIds: string[];
  // Your own time not on a submitted invoice.
  unsubmittedTimeProfessionalIds: string[];
  // Draft or withdrawn invoices you can read, by whom they bill.
  unsubmittedInvoiceProfessionalIds: string[];
}

export interface MyCaseProfessional {
  professionalId: string;
  displayName: string | null;
  isSelf: boolean;
}

export interface MyCasesResult {
  // Yourself first, then each professional you act for as a delegate.
  professionals: MyCaseProfessional[];
  cases: MyCaseRecord[];
}

export function listMyCases(): Promise<MyCasesResult> {
  return request<MyCasesResult>('/api/my-cases');
}

export interface TimeEntryRecord {
  timeEntryId: string;
  caseId: string;
  professionalId: string;
  activityTypeId: string;
  activityOn: string;
  durationHours: string;
  description: string;
  // The invoice billing it; null while unbilled (a withdrawn invoice frees it).
  billing: { invoiceId: string; statusCode: string } | null;
  // Why it can't be edited or deleted here, or null.
  lockedReason: string | null;
}

export interface CreateTimeEntryInput {
  caseId: string;
  activityOn: string;
  durationHours: number;
  description: string;
  // Whose work it is; defaults to your own.
  professionalId?: string;
}

export function listMyTimeEntries(caseId: string): Promise<{ timeEntries: TimeEntryRecord[] }> {
  return request<{ timeEntries: TimeEntryRecord[] }>(`/api/portal/time-entries?caseId=${encodeURIComponent(caseId)}`);
}

export function createTimeEntry(input: CreateTimeEntryInput): Promise<{ timeEntryId: string }> {
  return request<{ timeEntryId: string }>('/api/portal/time-entries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type UpdateTimeEntryInput = Pick<CreateTimeEntryInput, 'activityOn' | 'durationHours' | 'description'>;

export function updateTimeEntry(timeEntryId: string, input: UpdateTimeEntryInput): Promise<{ timeEntryId: string }> {
  return request<{ timeEntryId: string }>(`/api/portal/time-entries/${timeEntryId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteTimeEntry(timeEntryId: string): Promise<{ timeEntryId: string }> {
  return request<{ timeEntryId: string }>(`/api/portal/time-entries/${timeEntryId}`, { method: 'DELETE' });
}

export interface InvoiceRecord {
  invoiceId: string;
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
  serviceDateInferred?: boolean;
  timekeeperLabel?: string;
  taskCode?: string;
  activityCode?: string;
  expenseCode?: string;
  // Whose work the line bills; a delegated invoice defaults it server-side.
  timekeeperProfessionalId?: string;
  // Mileage only; quantity is the miles for the whole trip.
  tripOrigin?: string;
  tripDestination?: string;
  roundTrip?: boolean;
  // The imported file's line or row it was read from; carried back on save.
  sourceLocation?: string;
}

// Who the signed-in user may bill for on a case: themselves, and anyone
// they act for as an office delegate.
export interface BillableProfessional {
  professionalId: string;
  displayName: string | null;
  isSelf: boolean;
  // Whose rates price their time, e.g. "Attorney"; null if none is set.
  kindDisplayName: string | null;
  // Their kind's rates, oldest first; set by administrators.
  rates: ProfessionalRate[];
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
}

// What a submitter confirms when sending (server/src/billing/invoiceLifecycle.ts).
export const ATTESTATION_STATEMENT = 'I confirm this invoice is true and correct, and the work was done for this case.';

// A request's file as read (server/src/imports/invoiceFile.ts): each line as
// first drafted from it, which the submitter's changes are shown against.
export interface FileLine {
  location: string;
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
  lines: FileLine[];
  warnings: ImportWarning[];
}

export interface SubmitterChanges {
  changedCount: number;
  removedCount: number;
  addedCount: number;
}

export interface CreateInvoiceInput extends DraftInvoiceContent, InvoiceReceipt {
  // Null: it waits on Intake for its case.
  caseId: string | null;
  // Whose work the invoice bills; defaults to the caller's own profile. Null:
  // staff choose when they match it to a case (no case, draft only).
  professionalId?: string | null;
  // False keeps it as an editable draft; the server defaults to submitting.
  submit?: boolean;
}

// Intake: invoices held until they are matched to a case.
export interface IntakeItem {
  invoiceId: string | null;
  invoiceImportId: string | null;
  fileName: string | null;
  stage: 'reading' | 'unreadable' | 'to_confirm' | 'ready';
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
}

export function listInvoiceIntake(): Promise<{ items: IntakeItem[] }> {
  return request('/api/invoices/intake');
}

// addMissing adds the invoice's providers to the case when they aren't on it.
// professionalId: whom it bills, when it was saved without one.
export function matchInvoiceToCase(invoiceId: string, input: { caseId: string; addMissing?: boolean; professionalId?: string }) {
  return request<{ invoiceId: string; caseId: string; addedProfessionalIds: string[] }>(`/api/invoices/intake/${invoiceId}/case`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// A provider who hasn't signed in; they get this profile if they do later.
export function addProfessional(input: { displayName: string; email?: string; professionalKindId: string }) {
  return request<{ professionalId: string; displayName: string }>('/api/professionals', { method: 'POST', body: JSON.stringify(input) });
}

export function listReceiptChannels(): Promise<{ channels: Array<{ code: string; displayName: string }> }> {
  return request('/api/portal/receipt-channels');
}

// Every invoice this user may read, or one case's.
export function listMyInvoices(caseId?: string): Promise<{ invoices: InvoiceRecord[] }> {
  const query = caseId ? `?caseId=${encodeURIComponent(caseId)}` : '';
  return request<{ invoices: InvoiceRecord[] }>(`/api/portal/invoices${query}`);
}

export function updateDraftInvoice(invoiceId: string, content: DraftInvoiceContent): Promise<{ invoiceId: string; submittedTotal: string }> {
  return request<{ invoiceId: string; submittedTotal: string }>(`/api/portal/invoices/${invoiceId}`, {
    method: 'PUT',
    body: JSON.stringify(content),
  });
}

export type InvoiceTransition = 'submit' | 'recall' | 'withdraw';

export function transitionInvoice(
  invoiceId: string,
  transition: InvoiceTransition,
  receipt?: InvoiceReceipt,
): Promise<{ invoiceId: string }> {
  return request<{ invoiceId: string }>(`/api/portal/invoices/${invoiceId}/${transition}`, {
    method: 'POST',
    body: receipt ? JSON.stringify(receipt) : undefined,
  });
}

// Reviewer identities aren't sent to the portal; see ../../server/src/routes/portal.ts.
export type PortalInvoiceLine = Omit<InvoiceReviewLine, 'decidedByDisplayName'>;

export interface PortalInvoice {
  invoice: QueuedInvoice;
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
}

export function deleteInvoice(invoiceId: string): Promise<{ invoiceId: string }> {
  return request<{ invoiceId: string }>(`/api/portal/invoices/${invoiceId}`, { method: 'DELETE' });
}

export function getMyInvoice(invoiceId: string): Promise<PortalInvoice> {
  return request<PortalInvoice>(`/api/portal/invoices/${invoiceId}`);
}

// --- Supporting invoice import ---------------------------------------------

export interface ImportWarning {
  code: string;
  message: string;
  location?: string;
}

// Where a file still being read has got to (server/src/imports/extractionJobs.ts):
// waiting behind other files, reading, or recognizing a scan's text.
export type ImportProgress =
  | { stage: 'queued'; ahead: number }
  | { stage: 'reading' }
  | { stage: 'recognizing'; page: number; pages: number };

export interface InvoiceImportDetail {
  invoiceImportId: string;
  uploadedAt: string;
  caseId: string | null;
  statusCode: 'received' | 'extracted' | 'failed' | 'confirmed' | 'discarded';
  statusDisplayName: string;
  formatDisplayName: string;
  extractionMethod: string | null;
  extractedAt: string | null;
  extractionResult: {
    invoice?: { invoice_number?: { value: string } };
    lines?: Array<{ location: string }>;
    warnings?: ImportWarning[];
    // Set when the file was designated to one professional: all their work.
    designated_professional_id?: string;
  } | null;
  invoiceId: string | null;
  resolvedAt: string | null;
  fileName: string;
  fileAvailable: boolean;
  expiresAt: string | null;
  // Set while the file is still being read (status received).
  progress: ImportProgress | null;
  possibleDuplicateTime: Array<{
    invoiceLineId: string;
    timeEntryId: string;
    activityOn: string;
    durationHours: string;
    description: string;
  }>;
}

// The file goes as the raw body; the server identifies it from its content.
// No case: the file waits on Intake until it is matched.
export async function uploadInvoiceFile(
  caseId: string | null,
  file: File,
  professionalId?: string,
): Promise<{ invoiceImportId: string; status: string; invoiceId: string | null }> {
  const query = new URLSearchParams({ ...(caseId ? { caseId } : {}), ...(professionalId ? { professionalId } : {}) });
  const response = await fetch(`/api/portal/invoice-imports?${query.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as { invoiceImportId: string; status: string; invoiceId: string | null };
}

export function getInvoiceImport(importId: string): Promise<InvoiceImportDetail> {
  return request<InvoiceImportDetail>(`/api/portal/invoice-imports/${importId}`);
}

// An import still in progress: unresolved, or confirmed with its draft not
// yet submitted (server/src/imports/invoiceImports.ts listInvoiceImports).
export interface ImportInProgress {
  invoiceImportId: string;
  uploadedAt: string;
  statusCode: string;
  fileName: string;
  caseId: string | null;
  caseExternalReference: string | null;
  caseClientDisplayName: string | null;
  invoiceId: string | null;
  invoiceStatusCode: string | null;
  professionalDisplayName: string | null;
  submittedTotal: string | null;
  // The file's own amounts, summed; differs when rates reprice time.
  statedTotal: string | null;
  lineCount: number;
  unmatchedCount: number;
  // Lines still without a date, and dates filled from the billing period.
  undatedCount: number;
  inferredDateCount: number;
  warningCount: number;
  // Warnings other than the date notes above.
  otherWarningCount: number;
  // Why a failed import couldn't be read.
  failureMessage: string | null;
  expiresAt: string | null;
  // Set while the file is still being read (status received).
  progress: ImportProgress | null;
}

// A file for one professional whose lines name their cases
// (server/src/imports/splitByCase.ts).
export interface CaseSplitPreview {
  cases: Array<{ caseId: string; externalReference: string | null; clientDisplayName: string | null }>;
  lines: Array<{
    index: number;
    location: string;
    caseLabel: string | null;
    lineType: InvoiceLineType;
    serviceDate: string | null;
    description: string | null;
    quantity: number | null;
    // As the file states it.
    amount: number;
    // What will be billed: a time line at the professional's rate on its date.
    billedRate: string | null;
    billedAmount: number | null;
    suggestedCaseId: string | null;
  }>;
}

// The file is read in the background, like an upload; poll its read.
export async function startCaseSplit(file: File, professionalId: string): Promise<{ splitReadId: string }> {
  const query = new URLSearchParams({ professionalId });
  const response = await fetch(`/api/portal/invoice-imports/case-split/reads?${query.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as { splitReadId: string };
}

export type CaseSplitRead =
  | { status: 'reading'; progress: ImportProgress | null }
  | { status: 'failed'; failureMessage: string }
  | { status: 'ready'; preview: CaseSplitPreview };

// The portal upload (server/src/imports/splitByCase.ts): read first, then
// the submitter confirms its case, period and invoice number.
export interface UploadCase {
  caseId: string;
  professionalId: string;
  caseNumber: string | null;
  clientDisplayName: string | null;
  professionalDisplayName: string | null;
}

export interface UploadFile {
  fileName: string;
  sizeBytes: number;
  format: 'ledes_1998b' | 'spreadsheet' | 'document';
}

export type UploadRead =
  | { status: 'reading'; file: UploadFile; progress: ImportProgress | null }
  | { status: 'failed'; file: UploadFile; failureMessage: string }
  | {
      status: 'ready';
      file: UploadFile;
      read: {
        lineCount: number;
        invoiceNumber: string | null;
        periodStart: string | null;
        periodEnd: string | null;
        statedTotal: number | null;
      };
      cases: UploadCase[];
      suggested: { caseId: string; professionalId: string } | null;
    };

export async function startUpload(file: File): Promise<{ uploadReadId: string }> {
  const response = await fetch('/api/portal/uploads', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as { uploadReadId: string };
}

export function getUpload(uploadReadId: string): Promise<UploadRead> {
  return request<UploadRead>(`/api/portal/uploads/${uploadReadId}`);
}

export function discardUpload(uploadReadId: string): Promise<{ splitReadId: string }> {
  return request(`/api/portal/uploads/${uploadReadId}`, { method: 'DELETE' });
}

export function createUploadDraft(
  uploadReadId: string,
  details: { caseId: string; professionalId: string; periodStart?: string; periodEnd?: string; invoiceNumber?: string },
): Promise<{ invoiceImportId: string; invoiceId: string }> {
  return request(`/api/portal/uploads/${uploadReadId}/draft`, { method: 'POST', body: JSON.stringify(details) });
}

export function getCaseSplitRead(splitReadId: string): Promise<CaseSplitRead> {
  return request<CaseSplitRead>(`/api/portal/invoice-imports/case-split/reads/${splitReadId}`);
}

export function discardCaseSplitRead(splitReadId: string): Promise<{ splitReadId: string }> {
  return request(`/api/portal/invoice-imports/case-split/reads/${splitReadId}`, { method: 'DELETE' });
}

// One case per line, in the file's order; makes one import per case from
// the file and reading already on the server.
export function uploadInvoiceFileByCase(
  splitReadId: string,
  caseIds: string[],
): Promise<{ imports: Array<{ invoiceImportId: string; caseId: string; invoiceId: string }> }> {
  return request('/api/portal/invoice-imports/case-split', { method: 'POST', body: JSON.stringify({ splitReadId, caseIds }) });
}

export function listInvoiceImports(): Promise<{ imports: ImportInProgress[] }> {
  return request<{ imports: ImportInProgress[] }>('/api/portal/invoice-imports');
}

export function resolveInvoiceImport(importId: string, action: 'confirm' | 'discard'): Promise<{ invoiceImportId: string }> {
  return request<{ invoiceImportId: string }>(`/api/portal/invoice-imports/${importId}/${action}`, { method: 'POST' });
}

export type ImportPreview =
  | { kind: 'pdf' }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'rows'; rows: string[][]; truncated: boolean };

export function getImportPreview(importId: string): Promise<ImportPreview> {
  return request<ImportPreview>(`/api/portal/invoice-imports/${importId}/preview`);
}

export async function getImportFileBytes(importId: string): Promise<ArrayBuffer> {
  return fileBytes(invoiceImportFileUrl(importId));
}

export async function fileBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, undefined);
  }
  return response.arrayBuffer();
}

export function invoiceImportFileUrl(importId: string): string {
  return `/api/portal/invoice-imports/${importId}/file`;
}

export function invoiceTemplateUrl(format: 'csv' | 'xlsx'): string {
  return `/api/portal/invoice-imports/template?format=${format}`;
}

// The server's message for a 4xx, when it sent one.
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; fieldErrors?: Record<string, string> } | undefined;
    const fieldMessage = body?.fieldErrors ? Object.values(body.fieldErrors)[0] : undefined;
    return fieldMessage ?? body?.message ?? fallback;
  }
  return fallback;
}

export type InvoiceExportFormat = 'pdf' | 'xlsx';

// A plain link, not a fetch: the browser downloads the attachment with the
// session cookie.
export function invoiceExportUrl(scope: 'staff' | 'portal', invoiceId: string, format: InvoiceExportFormat): string {
  const base = scope === 'staff' ? '/api/invoices' : '/api/portal/invoices';
  return `${base}/${invoiceId}/export?format=${format}`;
}

export function createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; submittedTotal: string }> {
  return request<{ invoiceId: string; submittedTotal: string }>('/api/portal/invoices', {
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
}

export interface AssignedPerson {
  userAccountId: string;
  displayName: string;
}

export interface QueueFlag {
  kind: 'rate' | 'arithmetic' | 'rule';
  message: string;
}

// The staff review queue (../pages/ReviewQueue.tsx).
export interface ReviewQueueItem extends QueuedInvoice {
  caseNumber: string | null;
  otherCaseNumbers: string[];
  lineCount: number;
  decidedCount: number;
  // From the latest finished round; null until one is finished.
  approvedTotal: string | null;
  reviewer: AssignedPerson | null;
  // Who must act now: the next approver while it waits for sign-off.
  holder: AssignedPerson | null;
  workingDaysWaiting: number;
  flags: QueueFlag[];
}

export function listReviewQueue(view: 'open' | 'finished'): Promise<{ invoices: ReviewQueueItem[]; waitingAlertWorkingDays: number }> {
  return request(`/api/invoices?view=${view}`);
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

// Which list a reason is on: approving in part, rejecting, or both.
export type ReasonAppliesTo = 'approved_in_part' | 'rejected' | 'both';

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

// One row per submitted invoice, for reports outside the tool.
export function billingRecordUrl(format: 'csv' | 'xlsx'): string {
  return `/api/invoices/billing-record?format=${format}`;
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
  // Filled from the billing period on import, until the date is changed.
  serviceDateInferred: boolean;
  description: string | null;
  quantity: string | null;
  // As stated on an imported file; a time line is billed at it.
  unitRate: string | null;
  statedAmount: string | null;
  // The rate a time or mileage line is billed at.
  billedRate: string | null;
  // Time lines: the configured rate for the professional's kind.
  configuredRate: string | null;
  // Time lines: what the rate check compares to, the pre-authorized rate
  // when the case has one, else the configured rate.
  rateLimit: string | null;
  rateLimitSource: 'preauthorized' | 'configured' | null;
  // 'mileage' on a mileage line; its quantity is the miles claimed.
  expenseTypeCode: string | null;
  tripOrigin: string | null;
  tripDestination: string | null;
  roundTrip: boolean;
  // One-way driving miles, once looked up on submission.
  routeDistance: string | null;
  routeCheckedAt: string | null;
  timekeeperLabel: string | null;
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

export interface InvoiceReview {
  invoice: QueuedInvoice;
  // This professional's pre-authorization on the case, if there is one.
  preauthorization: PreauthorizationSummary | null;
  caseNumber: string | null;
  otherCaseNumbers: string[];
  lines: InvoiceReviewLine[];
  ruleFindings: RuleFinding[];
  round: number | null;
  approvedTotal: string | null;
  signOffs: SignOff[];
  assignments: { reviewer: AssignedPerson | null; signOff: Array<AssignedPerson & { position: number }> } | null;
  // Staff only, while waiting for sign-off: who signs next, and whether
  // anyone has signed this round (which ends reopening).
  nextSignOff: AssignedPerson | null;
  signOffStarted: boolean;
  fileSource: FileSource | null;
  submitterChanges: SubmitterChanges | null;
}

export function getInvoiceForReview(invoiceId: string): Promise<InvoiceReview> {
  return request(`/api/invoices/${invoiceId}`);
}

// The file a request was read from, for staff viewing it beside the lines.
export function getInvoiceFilePreview(invoiceId: string): Promise<ImportPreview> {
  return request<ImportPreview>(`/api/invoices/${invoiceId}/file/preview`);
}

export function invoiceFileUrl(invoiceId: string): string {
  return `/api/invoices/${invoiceId}/file`;
}

export interface LineDecisionInput {
  outcome: DecisionOutcome;
  approvedQuantity?: number;
  approvedRate?: number;
  approvedAmount?: number;
  reasonCode?: string;
  note?: string;
}

export function decideInvoiceLine(invoiceId: string, invoiceLineId: string, input: LineDecisionInput): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/lines/${invoiceLineId}/decision`, { method: 'PUT', body: JSON.stringify(input) });
}

export function undoInvoiceLineDecision(invoiceId: string, invoiceLineId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/lines/${invoiceLineId}/decision`, { method: 'DELETE' });
}

export function repriceInvoice(invoiceId: string): Promise<{ repriced: number }> {
  return request(`/api/invoices/${invoiceId}/reprice`, { method: 'POST' });
}

export function finishReview(invoiceId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/finish`, { method: 'POST' });
}

export function reopenReview(invoiceId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/reopen`, { method: 'POST' });
}

export function signOffInvoice(invoiceId: string, input: { outcome: 'approved' | 'changes_requested'; comment?: string }): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/sign-off`, { method: 'POST', body: JSON.stringify(input) });
}

export function reassignReviewer(invoiceId: string, input: { userAccountId: string; forCase: boolean }): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/reviewer`, { method: 'PUT', body: JSON.stringify(input) });
}

export function setSignOffApprovers(invoiceId: string, userAccountIds: string[]): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/sign-off-approvers`, { method: 'PUT', body: JSON.stringify({ userAccountIds }) });
}

export interface ReviewSettings {
  defaultReviewerUserAccountId: string | null;
  defaultSignOffUserAccountIds: string[];
  waitingAlertWorkingDays: number;
}

export function getReviewSettings(): Promise<ReviewSettings> {
  return request('/api/settings/review');
}

export function setReviewSettings(input: Partial<ReviewSettings>): Promise<ReviewSettings> {
  return request('/api/settings/review', { method: 'PUT', body: JSON.stringify(input) });
}

export interface StaffRolesResponse {
  roles: Array<{ roleId: string; displayName: string }>;
  // Deactivated accounts too.
  people: Array<{ userAccountId: string; displayName: string; email: string; active: boolean; roleId: string }>;
}

export function getStaffRoles(): Promise<StaffRolesResponse> {
  return request('/api/settings/staff-roles');
}

export function setStaffRole(userAccountId: string, roleId: string): Promise<unknown> {
  return request(`/api/settings/staff-roles/${userAccountId}`, { method: 'PUT', body: JSON.stringify({ roleId }) });
}

export function addStaffAccount(input: { displayName: string; email: string; roleId: string }): Promise<{ userAccountId: string }> {
  return request('/api/settings/staff', { method: 'POST', body: JSON.stringify(input) });
}

export function setStaffActive(userAccountId: string, active: boolean): Promise<unknown> {
  return request(`/api/settings/staff/${userAccountId}/active`, { method: 'PUT', body: JSON.stringify({ active }) });
}

// Deletes all data and recreates the demo data; ends the session.
export function resetDemoData(): Promise<unknown> {
  return request('/api/settings/demo/reset', { method: 'POST' });
}

export function getOwnDemoRole(): Promise<{ roles: StaffRolesResponse['roles']; roleId: string }> {
  return request('/api/settings/demo/role');
}

export function setOwnDemoRole(roleId: string): Promise<unknown> {
  return request('/api/settings/demo/role', { method: 'PUT', body: JSON.stringify({ roleId }) });
}

export function closeCase(
  caseId: string,
  reasonDetail: string,
): Promise<{ caseId: string; caseLifecycleEventId: string; closedOn: string }> {
  return request<{ caseId: string; caseLifecycleEventId: string; closedOn: string }>(`/api/cases/${caseId}/close`, {
    method: 'POST',
    body: JSON.stringify({ reasonDetail }),
  });
}
