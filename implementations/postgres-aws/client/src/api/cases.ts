import { request } from './http';
import type { AssignedPerson, ReviewQueueItem } from './reviewQueue';

// Mirrors server/src/cases/caseStage.ts's CASE_STAGES; null once a case
// is closed (case.closedOn set) — it has left the working board.
export type CaseStage = 'needs-assignment' | 'represented' | 'billing' | 'closing';

export interface CaseRecord {
  caseId: string;
  clientId: string | null;
  clientDisplayName: string | null;
  countyId: string | null;
  countyDisplayName: string | null;
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

// As listed: with its number, who works on it, what is pre-authorized and what is waiting.
export interface CaseListRecord extends CaseRecord {
  caseNumber: string | null;
  workers: string[];
  // Every pre-authorization on the case added up; null with none.
  preauthorized: string | null;
  waiting: { count: number; total: string };
}

export function listCases(): Promise<{ cases: CaseListRecord[] }> {
  return request<{ cases: CaseListRecord[] }>('/api/cases');
}

export interface CaseChange {
  caseId: string;
  clientDisplayName: string | null;
  caseNumber: string | null;
  what: string;
  when: string;
  by: string | null;
}

export function listRecentCaseChanges(): Promise<{ changes: CaseChange[] }> {
  return request('/api/cases/recent-changes');
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
  // What stops it closing here: invoices in review, and decided ones not marked completed.
  unfinishedInvoices: { waiting: number; notCompleted: number };
}

export function getCase(caseId: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/cases/${caseId}`);
}

export interface PreauthorizationSummary {
  professionalId: string | null;
  // 'threshold': nothing pre-authorized; ceiling is the county's threshold.
  source: 'preauthorized' | 'threshold';
  preauthorizationId: string | null;
  authorizationNumbers: string[];
  ceiling: string;
  approvedSoFar: string;
  waiting: string;
}

export type RateType = 'hourly' | 'travel' | 'waiting' | 'mileage';

export type RateSource = 'case_person' | 'case_kind' | 'person' | 'kind' | 'general';

// A reviewer's default rate for one person or kind on a case. Staff only.
export interface CaseRate {
  caseRateId: string;
  professionalId: string | null;
  professionalDisplayName: string | null;
  professionalKindId: string | null;
  kindDisplayName: string | null;
  rateType: RateType;
  // Null: back to the configured rate.
  rate: string | null;
  replacedRate: string | null;
  effectiveFrom: string;
  reasonDisplayName: string;
  note: string | null;
  invoiceId: string;
  invoiceNumber: string | null;
  correctsCaseRateId: string | null;
  recordedByDisplayName: string;
  recordedAt: string;
  inForce: boolean;
}

export interface CaseInvoices {
  invoices: ReviewQueueItem[];
  preauthorizations: PreauthorizationSummary[];
  caseRates: CaseRate[];
  // Where this case's new invoices go, ahead of the default.
  reviewer: AssignedPerson | null;
  caseNumber: string | null;
  otherCaseNumbers: string[];
}

export function getCaseInvoices(caseId: string): Promise<CaseInvoices> {
  return request<CaseInvoices>(`/api/cases/${caseId}/invoices`);
}

// Any staff member enters or changes a pre-authorized amount; null professionalId: the whole case.
export function setPreauthorizedAmount(
  caseId: string,
  input: { professionalId: string | null; amount: number; authorizationNumber?: string },
): Promise<{ preauthorizationId: string }> {
  return request(`/api/cases/${caseId}/preauthorizations`, { method: 'POST', body: JSON.stringify(input) });
}

export interface CaseByNumber {
  caseId: string;
  caseNumber: string | null;
  otherNumbers: string[];
  clientDisplayName: string | null;
  countyDisplayName: string | null;
  closed: boolean;
  match: 'exact' | 'close';
}

// Cases with the number an invoice filed by person gives.
export function findCaseMatches(invoiceId: string): Promise<{ cases: CaseByNumber[] }> {
  return request(`/api/invoices/${invoiceId}/case-matches`);
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

export function createCase(input: CreateCaseInput): Promise<CreateCaseResult> {
  return request<CreateCaseResult>('/api/cases', { method: 'POST', body: JSON.stringify(input) });
}

// --- External portal (view/log time, submit invoices) ---------------------

export function closeCase(
  caseId: string,
  reasonDetail: string,
): Promise<{ caseId: string; caseLifecycleEventId: string; closedOn: string }> {
  return request<{ caseId: string; caseLifecycleEventId: string; closedOn: string }>(`/api/cases/${caseId}/close`, {
    method: 'POST',
    body: JSON.stringify({ reasonDetail }),
  });
}

// --- Pre-authorization requests (server/src/routes/preauthorizations.ts) ---

// --- Possible duplicate cases (staff; never merged here) ---------------------

export interface DuplicateCase {
  caseId: string;
  caseNumber: string | null;
  otherNumbers: string[];
  clientDisplayName: string | null;
  countyDisplayName: string | null;
  openedOn: string | null;
  invoiceCount: number;
}

export interface PossibleDuplicateCase {
  cases: DuplicateCase[];
  pairs: Array<{
    caseIds: [string, string];
    reasons: Array<'same_number' | 'same_county' | 'flagged'>;
    flagged: { note: string | null; byDisplayName: string; at: string } | null;
  }>;
}

export function listPossibleDuplicateCases(): Promise<{ duplicates: PossibleDuplicateCase[] }> {
  return request('/api/cases/possible-duplicates');
}

export function reviewPossibleDuplicateCase(input: { caseIds: [string, string]; outcome: 'possible_duplicate' | 'not_duplicate'; note?: string }) {
  return request<void>('/api/cases/possible-duplicates', { method: 'POST', body: JSON.stringify(input) });
}
