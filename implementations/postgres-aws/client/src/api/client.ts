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
  authType: 'sso' | 'magic-link';
  ssoProvider?: string;
}

export function getCurrentUser(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/me');
}

export function demoLogin(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-login', { method: 'POST' });
}

export function externalDemoLogin(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-login/external', { method: 'POST' });
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
export function requestMagicLink(email: string): Promise<void> {
  return request<void>('/auth/magic-link/request', { method: 'POST', body: JSON.stringify({ email }) });
}

// Consumes the single-use token; 401 if it is invalid, expired, or used.
export function verifyMagicLink(token: string): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/magic-link/verify', { method: 'POST', body: JSON.stringify({ token }) });
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

// Read-only, one case; review happens via reviewInvoiceLine below.
export function getCaseInvoices(caseId: string): Promise<{ invoices: InvoiceRecord[] }> {
  return request<{ invoices: InvoiceRecord[] }>(`/api/cases/${caseId}/invoices`);
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

// External vendors (professionals) — the sidebar's Vendors directory.
export interface VendorRecord {
  professionalId: string;
  displayName: string | null;
  active: boolean;
  email: string;
}

export function listVendors(query: string): Promise<{ professionals: VendorRecord[] }> {
  return request<{ professionals: VendorRecord[] }>(`/api/professionals?q=${encodeURIComponent(query)}`);
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
  clientDisplayName: string | null;
  assignedAt: string;
}

export function listMyCases(): Promise<{ cases: MyCaseRecord[] }> {
  return request<{ cases: MyCaseRecord[] }>('/api/my-cases');
}

export interface TimeEntryRecord {
  timeEntryId: string;
  caseId: string;
  professionalId: string;
  activityTypeId: string;
  activityOn: string;
  durationHours: string;
  description: string;
}

export interface CreateTimeEntryInput {
  caseId: string;
  activityOn: string;
  durationHours: number;
  description: string;
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

export interface InvoiceRecord {
  invoiceId: string;
  caseId: string;
  statusId: string;
  statusDisplayName: string;
  submittedAt: string | null;
  submittedTotal: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface CreateInvoiceLineInput {
  amount: number;
  sourceTimeEntryId?: string;
}

export interface CreateInvoiceInput {
  caseId: string;
  periodStart?: string;
  periodEnd?: string;
  lines: CreateInvoiceLineInput[];
}

export function listMyInvoices(caseId: string): Promise<{ invoices: InvoiceRecord[] }> {
  return request<{ invoices: InvoiceRecord[] }>(`/api/portal/invoices?caseId=${encodeURIComponent(caseId)}`);
}

export function createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; submittedTotal: string }> {
  return request<{ invoiceId: string; submittedTotal: string }>('/api/portal/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// The staff-facing billing review queue (../pages/BillingQueue.tsx) — a
// cross-case listing, unlike getCaseInvoices above (one case).
export interface QueuedInvoice {
  invoiceId: string;
  caseId: string;
  caseClientDisplayName: string | null;
  caseExternalReference: string | null;
  professionalId: string;
  professionalDisplayName: string | null;
  statusId: string;
  statusCode: string;
  statusDisplayName: string;
  submittedAt: string | null;
  submittedTotal: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export function listInvoices(status?: string): Promise<{ invoices: QueuedInvoice[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<{ invoices: QueuedInvoice[] }>(`/api/invoices${query}`);
}

export type ReviewOutcome = 'approved' | 'rejected';

// Decision fields are null until the line is reviewed.
export interface InvoiceReviewLine {
  invoiceLineId: string;
  amount: string;
  sourceTimeEntryId: string | null;
  sourceActivityOn: string | null;
  sourceDurationHours: string | null;
  sourceDescription: string | null;
  decisionOutcomeCode: ReviewOutcome | null;
  decisionOutcomeDisplayName: string | null;
  decisionApprovedAmount: string | null;
  decisionReason: string | null;
  decidedByDisplayName: string | null;
  decidedAt: string | null;
}

export function getInvoiceForReview(invoiceId: string): Promise<{ invoice: QueuedInvoice; lines: InvoiceReviewLine[] }> {
  return request<{ invoice: QueuedInvoice; lines: InvoiceReviewLine[] }>(`/api/invoices/${invoiceId}`);
}

export interface ReviewInvoiceLineInput {
  outcome: ReviewOutcome;
  approvedAmount?: number;
  reason?: string;
}

export function reviewInvoiceLine(
  invoiceId: string,
  invoiceLineId: string,
  input: ReviewInvoiceLineInput,
): Promise<{ invoiceId: string; invoiceLineId: string; statusId: string }> {
  return request<{ invoiceId: string; invoiceLineId: string; statusId: string }>(
    `/api/invoices/${invoiceId}/lines/${invoiceLineId}/review`,
    { method: 'POST', body: JSON.stringify(input) },
  );
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
