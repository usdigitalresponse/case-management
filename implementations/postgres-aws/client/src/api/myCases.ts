import { request } from './http';
import type { PreauthorizationSummary } from './cases';

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
  // For the people listed.
  preauthorizations: PreauthorizationSummary[];
}

export interface MyCaseProfessional {
  professionalId: string;
  displayName: string | null;
  kindDisplayName: string | null;
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
