// Settings, Edit data: administrators fix cases added by mistake (server/src/cases/caseCorrections.ts).
import { request } from './http';

export interface AddedCase {
  caseId: string;
  caseNumber: string | null;
  countyId: string | null;
  countyDisplayName: string | null;
  clientDisplayName: string | null;
  addedAt: string;
  addedByDisplayName: string | null;
  addedFrom: 'invoice' | 'preauthorization_request';
  invoices: number;
  preauthorizationRequests: number;
  similar: Array<{ caseId: string; caseNumber: string | null; clientDisplayName: string | null }>;
}

export type CaseFix =
  | { kind: 'same_case'; caseId: string; keptCaseId: string; keepPreauthorizations?: Record<string, 'moved' | 'kept'> }
  | { kind: 'corrected'; caseId: string; caseNumber?: string; countyId?: string; clientName?: string }
  | { kind: 'not_for_case'; caseId: string };

export interface CaseFixPreview {
  invoices: Array<{ invoiceId: string; senderDisplayName: string | null; statusName: string | null; submittedTotal: string | null; caseNumberAsTyped: string | null }>;
  preauthorizationRequests: Array<{ preauthorizationRequestId: string; requestNumber: string }>;
  preauthorizations: Array<{ preauthorizationId: string; providerDisplayName: string | null; staysOnClosedCase: boolean }>;
  // Providers both cases have a pre-authorization for: the administrator keeps one.
  preauthorizationChoices: Array<{ professionalId: string; providerDisplayName: string | null }>;
  assignmentsMoved: number;
  assignmentsEnded: number;
  caseChanges: Array<{ column: string; from: string | null; to: string | null }>;
  closes: boolean;
}

export interface CaseFixRecord {
  caseCorrectionId: string;
  caseId: string;
  caseNumber: string | null;
  kind: CaseFix['kind'];
  keptCaseId: string | null;
  keptCaseNumber: string | null;
  correctedAt: string;
  correctedByDisplayName: string;
  undoneAt: string | null;
}

export function listAddedCases(show: 'added' | 'similar'): Promise<{ cases: AddedCase[] }> {
  return request(`/api/edit-data/cases${show === 'similar' ? '?show=similar' : ''}`);
}

export function previewCaseFix(fix: CaseFix): Promise<CaseFixPreview> {
  return request('/api/edit-data/cases/preview', { method: 'POST', body: JSON.stringify(fix) });
}

export function fixCase(fix: CaseFix): Promise<{ caseCorrectionId: string; changed: number }> {
  return request('/api/edit-data/fixes', { method: 'POST', body: JSON.stringify(fix) });
}

export function listCaseFixes(): Promise<{ fixes: CaseFixRecord[] }> {
  return request('/api/edit-data/fixes');
}

export function undoCaseFix(caseCorrectionId: string): Promise<{ restored: number; leftAsIs: number }> {
  return request(`/api/edit-data/fixes/${caseCorrectionId}/undo`, { method: 'POST', body: '{}' });
}
