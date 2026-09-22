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
}

export function getCurrentUser(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/me');
}

export function devLogin(): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/dev-login', { method: 'POST' });
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' });
}

export interface CaseRecord {
  caseId: string;
  clientId: string | null;
  clientDisplayName: string | null;
  countyId: string | null;
  externalReference: string | null;
  caseCategoryId: string | null;
  statusId: string;
  openedOn: string | null;
  closedOn: string | null;
  organizationId: string | null;
  officeId: string | null;
  jurisdictionId: string | null;
  preferredLanguageId: string | null;
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

export interface CaseDetail {
  case: CaseRecord;
  participants: CaseParticipant[];
  lifecycleEvents: CaseLifecycleEvent[];
  identifiers: CaseIdentifier[];
}

export function getCase(caseId: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}`);
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
