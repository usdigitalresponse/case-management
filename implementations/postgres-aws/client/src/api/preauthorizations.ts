import { DATA_CHANGED_EVENT, request, sendFile } from './http';
import { batchParams, type Batch } from './batches';
import type { PreauthorizationSummary } from './cases';

export type RateBasis = 'hourly' | 'flat' | 'per_unit';

export type RequestStatusCode = 'submitted' | 'info_requested' | 'approved' | 'denied' | 'not_needed' | 'withdrawn';

export type RequestOutcome = 'approved' | 'denied' | 'not_needed' | 'duplicate' | 'moot';

export interface PreauthorizationRequestRow {
  preauthorizationRequestId: string;
  requestNumber: string;
  caseId: string | null;
  caseNumber: string | null;
  proposedCaseNumber: string | null;
  proposedCountyId: string | null;
  // Work not for one case: its decision is kept on the request alone.
  notForCase: boolean;
  countyId: string | null;
  countyName: string | null;
  professionalId: string | null;
  providerName: string | null;
  proposedProviderName: string | null;
  kindName: string | null;
  serviceDescription: string;
  rateBasis: RateBasis;
  requestedRate: string | null;
  estimatedQuantity: string | null;
  requestedAmount: string;
  justification: string;
  statusCode: RequestStatusCode;
  statusName: string;
  outcomeCode: RequestOutcome | null;
  outcomeName: string | null;
  decisionReason: string | null;
  approvedAmount: string | null;
  approvedHourlyRate: string | null;
  requestedByName: string;
  requestedForName: string | null;
  receivedVia: string | null;
  receivedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  // Null until the case and provider are matched.
  limit: PreauthorizationSummary | null;
}

export interface LinkedDocument {
  documentId: string;
  displayName: string;
  purposeCode: 'cv' | 'fee_schedule' | 'quote' | 'supporting';
  purposeName: string;
  recordedAt: string;
}

export interface ProviderDocuments {
  documents: LinkedDocument[];
  rates: Array<{ providerServiceRateId: string; serviceDescription: string; rate: string; rateBasis: RateBasis; effectiveFrom: string }>;
  missing: Array<'cv' | 'fee_schedule'>;
}

export interface PreauthorizationRequestDetail {
  request: PreauthorizationRequestRow;
  questions: Array<{
    preauthorizationQuestionId: string;
    question: string;
    askedByName: string;
    askedAt: string;
    answer: string | null;
    answeredByName: string | null;
    answeredAt: string | null;
  }>;
  documents: LinkedDocument[];
  providerDocuments: ProviderDocuments | null;
  canDecide: boolean;
}

export interface NewPreauthorizationRequest {
  caseId?: string | null;
  proposedCase?: { caseNumber: string; countyId?: string | null; countyName?: string };
  professionalId?: string | null;
  proposedProvider?: { name: string; email?: string };
  professionalKindId?: string | null;
  serviceDescription: string;
  rateBasis: RateBasis;
  requestedRate?: number | null;
  estimatedQuantity?: number | null;
  requestedAmount: number;
  justification: string;
  receivedVia?: string;
  receivedOn?: string;
}

export type RequestStatusCounts = Record<'submitted' | 'info_requested' | 'approved' | 'not_needed' | 'denied' | 'withdrawn' | 'in_review' | 'decided' | 'all', number>;

// Latest received first; staff filter them and get each status's count, a requester gets their own.
export function listPreauthorizationRequests(
  filter: { status?: string; countyId?: string; caseId?: string; from?: string; to?: string },
  after: string | null,
): Promise<Batch<PreauthorizationRequestRow, { counts: RequestStatusCounts }>> {
  const query = new URLSearchParams(Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return request(`/api/preauthorizations/requests?${batchParams(query, after)}`);
}

export function getPreauthorizationRequest(requestId: string) {
  return request<PreauthorizationRequestDetail>(`/api/preauthorizations/requests/${requestId}`);
}

export function createPreauthorizationRequest(input: NewPreauthorizationRequest) {
  return request<{ preauthorizationRequestId: string; requestNumber: string }>('/api/preauthorizations/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface RequestPreview {
  threshold: string | null;
  limit: PreauthorizationSummary | null;
  // Approved and waiting.
  billed: string;
  withinThreshold: boolean;
  documents: ProviderDocuments | null;
}

export function previewPreauthorizationRequest(input: { caseId?: string | null; professionalId?: string | null; countyId?: string | null; requestedAmount?: number }) {
  return request<RequestPreview>('/api/preauthorizations/requests/preview', { method: 'POST', body: JSON.stringify(input) }, { notifies: false });
}

export function listRequestableProviders() {
  return request<{ providers: Array<{ professionalId: string; displayName: string | null; professionalKindId: string | null; kindName: string | null }> }>(
    '/api/preauthorizations/providers',
  );
}

export function askPreauthorizationQuestion(requestId: string, question: string) {
  return request<PreauthorizationRequestDetail>(`/api/preauthorizations/requests/${requestId}/questions`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

export function answerPreauthorizationQuestion(requestId: string, questionId: string, answer: string) {
  return request<PreauthorizationRequestDetail>(`/api/preauthorizations/requests/${requestId}/questions/${questionId}/answer`, {
    method: 'POST',
    body: JSON.stringify({ answer }),
  });
}

export type PreauthorizationMatch = {
  caseId?: string;
  professionalId?: string;
  // Added from its number and county (server/src/cases/caseStep.ts).
  newCase?: { caseNumber: string; countyId: string | null; clientName?: string; confirmedNew?: boolean };
  notForCase?: boolean;
  countyId?: string;
};

export function matchPreauthorizationRequest(requestId: string, input: PreauthorizationMatch) {
  return request<PreauthorizationRequestDetail>(`/api/preauthorizations/requests/${requestId}/match`, { method: 'POST', body: JSON.stringify(input) });
}

export function decidePreauthorizationRequest(
  requestId: string,
  input: { outcome: RequestOutcome; approvedAmount?: number; approvedHourlyRate?: number | null; reason?: string },
) {
  return request<PreauthorizationRequestDetail>(`/api/preauthorizations/requests/${requestId}/decision`, { method: 'POST', body: JSON.stringify(input) });
}

export function withdrawPreauthorizationRequest(requestId: string) {
  return request<PreauthorizationRequestDetail>(`/api/preauthorizations/requests/${requestId}/withdraw`, { method: 'POST' });
}

export function uploadRequestDocument(requestId: string, file: File, purpose: LinkedDocument['purposeCode']) {
  return sendFile<{ documents: LinkedDocument[] }>(`/api/preauthorizations/requests/${requestId}/documents?purpose=${purpose}`, file).then((result) => {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    return result;
  });
}

// Takes a request's or provider's file off its list, keeping it; restoreDocument puts it back.
export function retireDocument(documentId: string) {
  return request<void>(`/api/preauthorizations/documents/${documentId}/retire`, { method: 'POST' });
}

export function restoreDocument(documentId: string) {
  return request<void>(`/api/preauthorizations/documents/${documentId}/restore`, { method: 'POST' });
}

export function getProviderDocuments(professionalId: string) {
  return request<ProviderDocuments>(`/api/preauthorizations/providers/${professionalId}/documents`);
}

export function uploadProviderDocument(professionalId: string, file: File, purpose: LinkedDocument['purposeCode']) {
  return sendFile<ProviderDocuments>(`/api/preauthorizations/providers/${professionalId}/documents?purpose=${purpose}`, file);
}

export function addProviderServiceRate(professionalId: string, input: { serviceDescription: string; rate: number; rateBasis: RateBasis; effectiveFrom: string }) {
  return request<ProviderDocuments>(`/api/preauthorizations/providers/${professionalId}/service-rates`, { method: 'POST', body: JSON.stringify(input) });
}

export function linkedDocumentUrl(documentId: string): string {
  return `/api/preauthorizations/documents/${documentId}`;
}

export interface CountyUsage {
  countyId: string | null;
  countyName: string;
  isCounty: boolean;
  threshold: string | null;
  requests: Record<'submitted' | 'info_requested' | 'approved' | 'not_needed' | 'denied' | 'withdrawn', number>;
  requested: string;
  approved: string;
  authorized: string;
  billedApproved: string;
  billedWaiting: string;
  left: string;
  over: { providers: number; amount: string; unexplained: number };
  withinThreshold: { providers: number; billed: string };
}

// Month-end totals; null for months not yet begun. withInReview is only on this month, and last month to join the line.
export interface UsageMonth {
  month: string;
  authorized: string | null;
  signedOff: string | null;
  withInReview: string | null;
}

export function getPreauthorizationUsage(period: { from: string; to: string }) {
  return request<{ from: string; to: string; counties: CountyUsage[]; total: CountyUsage; months: UsageMonth[] }>(
    `/api/preauthorizations/usage-by-county?${new URLSearchParams(period)}`,
  );
}

export interface ThresholdSettings {
  current: Array<{ countyId: string | null; countyName: string | null; isCounty: boolean; amount: string | null; effectiveFrom: string }>;
  history: Array<{ countyId: string | null; countyName: string | null; amount: string | null; effectiveFrom: string; recordedAt: string }>;
  kinds: Array<{ professionalKindId: string; displayName: string; thresholdApplies: boolean }>;
}

export function getThresholdSettings() {
  return request<ThresholdSettings>('/api/settings/preauthorization-thresholds');
}

export function addThreshold(input: { countyId: string | null; amount: number | null; effectiveFrom: string }) {
  return request<ThresholdSettings>('/api/settings/preauthorization-thresholds', { method: 'POST', body: JSON.stringify(input) });
}

export function setKindThresholdApplies(professionalKindId: string, thresholdApplies: boolean) {
  return request<ThresholdSettings>(`/api/settings/professional-kinds/${professionalKindId}/threshold-applies`, {
    method: 'PUT',
    body: JSON.stringify({ thresholdApplies }),
  });
}
