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

// Dispatched on window after a successful change, so views that summarize
// other pages' data (the sidebar counts) can reload.
export const DATA_CHANGED_EVENT = 'api:data-changed';

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
  if (init?.method && init.method !== 'GET') {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
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
  // Null for one added without it; fixed once they sign in with it.
  email: string | null;
  signedIn: boolean;
  professionalKindId: string | null;
  professionalKindDisplayName: string | null;
  // Their kind's rates, oldest first.
  rates: ProfessionalRate[];
}

export interface PersonDetailsInput {
  phone?: string;
  paidThrough?: string;
  hourlyRate?: number;
  ratePerMile?: number;
}

// Administrators only. A changed rate applies from today.
export function editProfessional(
  professionalId: string,
  input: { displayName: string; email?: string; professionalKindId?: string } & PersonDetailsInput,
) {
  return request<{ professionalId: string; displayName: string; email: string | null }>(`/api/professionals/${professionalId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// Administrators only; refused once anything lasting names them.
export function removeProfessional(professionalId: string): Promise<{ professionalId: string; releasedInvoiceIds: string[] }> {
  return request(`/api/professionals/${professionalId}`, { method: 'DELETE' });
}

// By whoever added them, until anything lasting names them; no email clears it.
export function correctProfessional(
  professionalId: string,
  details: { displayName: string; email?: string; professionalKindId?: string; givenName?: string; familyName?: string },
): Promise<{ professionalId: string; displayName: string; email: string | null }> {
  return request(`/api/professionals/${professionalId}/details`, { method: 'PUT', body: JSON.stringify(details) });
}

// Someone who can send invoices.
export interface BillingPerson {
  professionalId: string;
  displayName: string | null;
  active: boolean;
  email: string | null;
  signedIn: boolean;
  phone: string | null;
  paidThrough: string | null;
  professionalKindId: string | null;
  role: string | null;
  // Today's, their own or else their role's and the general mileage rate.
  hourlyRate: string | null;
  ratePerMile: string | null;
  waiting: { count: number; total: string };
  lastInvoiceAt: string | null;
}

export function listPeople(): Promise<{ people: BillingPerson[] }> {
  return request('/api/professionals/people');
}

export type BillingPersonDetail = Omit<BillingPerson, 'waiting' | 'lastInvoiceAt'> & { reviewer: AssignedPerson | null };

export function getPerson(professionalId: string): Promise<BillingPersonDetail> {
  return request(`/api/professionals/people/${professionalId}`);
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
  | 'mileage_distance'
  | 'travel_time_distance';

export interface BillingRule {
  code: BillingRuleCode;
  label: string;
  description: string;
  warnOnly: boolean;
  enforcement: RuleEnforcement;
  parameters: { increment?: number; hours?: number; withinMonth?: boolean; tolerancePercent?: number; averageSpeedMph?: number };
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

// Oldest first (server/src/billing/timeCategoryRates.ts). With none in force
// for a category, its time is priced at the hourly rate.
export type TimeCategory = 'travel' | 'waiting';
export type TimeCategoryBasis = 'hourly_rate' | 'percent_of_hourly_rate' | 'flat_rate';

export interface TimeCategoryRate {
  category: TimeCategory;
  basis: TimeCategoryBasis;
  percent: string | null;
  hourlyRate: string | null;
  effectiveFrom: string;
}

export function listTimeCategoryRates(): Promise<{ rates: TimeCategoryRate[] }> {
  return request('/api/settings/time-category-rates');
}

// Adds a setting from a date rather than changing an earlier one.
export function addTimeCategoryRate(input: {
  category: TimeCategory;
  basis: TimeCategoryBasis;
  percent?: number;
  hourlyRate?: number;
  effectiveFrom: string;
}): Promise<TimeCategoryRate> {
  return request('/api/settings/time-category-rates', { method: 'POST', body: JSON.stringify(input) });
}

// As server/src/billing/timeCategoryRates.ts prices it.
export function categoryRateOn(
  settings: TimeCategoryRate[],
  category: TimeCategory,
  date: string,
  hourlyRate: string | undefined,
): string | undefined {
  const setting = categoryRateIn(settings, category, date);
  if (setting?.basis === 'flat_rate') {
    return setting.hourlyRate ?? undefined;
  }
  if (hourlyRate === undefined) {
    return undefined;
  }
  if (setting?.basis === 'percent_of_hourly_rate') {
    return (Math.round(Number(hourlyRate) * Number(setting.percent)) / 100).toFixed(2);
  }
  return hourlyRate;
}

// The category's setting in force on a date; oldest first, so the last one started.
export function categoryRateIn(settings: TimeCategoryRate[], category: TimeCategory, date: string): TimeCategoryRate | undefined {
  return settings.filter((setting) => setting.category === category && setting.effectiveFrom <= date).at(-1);
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

// The rules in force, active codes, and mileage, travel and waiting time rates, for firms entering invoices.
export function getPortalBillingRules(): Promise<{
  rules: BillingRule[];
  codes: Array<{ code: string; displayName: string }>;
  mileageRates: MileageRate[];
  timeCategoryRates: TimeCategoryRate[];
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

// Settings recorded in a county's place (isCounty false) come first.
export interface CountyOption {
  countyId: string;
  displayName: string;
  isCounty: boolean;
}

export interface SavedCounty {
  countyId: string;
  displayName: string;
}

// countyId null clears it; countyName adds one, or reuses one with that name.
export interface CountyChoice {
  countyId?: string | null;
  countyName?: string;
}

export function listCounties(): Promise<{ counties: CountyOption[] }> {
  return request('/api/portal/counties');
}

export interface CreateCaseIdentifierInput {
  identifierTypeId: string;
  issuer: string;
  value: string;
  isPrimary?: boolean;
}

export interface CreateCaseInput {
  requestId: string;
  // An existing person, or a new one created with the case.
  personId?: string;
  newClient?: { displayName: string; email?: string; confirmedNew?: boolean };
  caseNumber?: string;
  participantRoleId: string;
  statusId: string;
  effectiveAt: string;
  countyId?: string;
  countyName?: string;
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

// The field errors a request was refused with (or that an error carries
// already, as NewCaseError does); empty if none.
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (err instanceof ApiError) {
    return isValidationErrorBody(err.body) ? err.body.fieldErrors : {};
  }
  const carried = (err as { fieldErrors?: unknown } | null)?.fieldErrors;
  return carried && typeof carried === 'object' ? (carried as Record<string, string>) : {};
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
}

// What a submitter confirms when sending (server/src/billing/invoiceLifecycle.ts).
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

// A provider who hasn't signed in; they get this profile if they do later.
// givenName and familyName: the name's parts, when entered separately.
export function addProfessional(
  input: { displayName: string; email?: string; professionalKindId: string; givenName?: string; familyName?: string } & PersonDetailsInput,
) {
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
): Promise<{ invoiceId: string; status?: SendStatus }> {
  return request<{ invoiceId: string; status?: SendStatus }>(`/api/portal/invoices/${invoiceId}/${transition}`, {
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
  questions: ReviewQuestion[];
  // Whether this user may answer its questions: whoever sent it, or the
  // professional it bills for.
  canAnswer: boolean;
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

export interface SuggestedImportLine {
  location: string;
  region?: SourceRegion;
  line_type?: { value: InvoiceLineType };
  service_date?: { value: string };
  description?: { value: string };
  quantity?: { value: number };
  unit_rate?: { value: number };
  amount: { value: number };
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
    lines?: Array<{ location: string; region?: SourceRegion }>;
    suggested_lines?: SuggestedImportLine[];
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
  // Blank dates, and dates taken from the line before.
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
        caseNumber: string | null;
        // countyId null: named in the file but not listed yet.
        county: { countyId: string | null; displayName: string } | null;
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

export function listUploadCases(): Promise<{ cases: UploadCase[] }> {
  return request('/api/portal/uploads/cases');
}

export function getUpload(uploadReadId: string): Promise<UploadRead> {
  return request<UploadRead>(`/api/portal/uploads/${uploadReadId}`);
}

export function discardUpload(uploadReadId: string): Promise<{ splitReadId: string }> {
  return request(`/api/portal/uploads/${uploadReadId}`, { method: 'DELETE' });
}

export function createUploadDraft(
  uploadReadId: string,
  // Null case or professional: it waits on Intake to be matched.
  details: {
    caseId: string | null;
    professionalId: string | null;
    proposedCase?: ProposedCase;
    proposedProvider?: ProposedProvider;
    periodStart?: string;
    periodEnd?: string;
    invoiceNumber?: string;
    caseNumber?: string;
    // A reviewer's goes straight into their own review.
    enterInReview?: boolean;
  } & CountyChoice &
    InvoiceReceipt,
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
}

export interface AssignedPerson {
  userAccountId: string;
  displayName: string;
}

export interface QueueFlag {
  kind: 'rate' | 'rate_changed' | 'arithmetic' | 'rule' | 'no_case';
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

export function signOffInvoice(invoiceId: string, input: { outcome: 'approved' | 'changes_requested'; comment?: string }): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/sign-off`, { method: 'POST', body: JSON.stringify(input) });
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
