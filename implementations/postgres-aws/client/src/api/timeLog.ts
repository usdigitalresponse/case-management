import { request } from './http';

export type TimeLogLineStatus =
  | 'matched'
  | 'linked'
  | 'hours_differ'
  | 'several'
  | 'combined'
  | 'date_differs'
  | 'other_account'
  | 'not_in_log'
  | 'not_checked';

export interface TimeLogEntryCheck {
  key: string;
  entryId: string | null;
  date: string | null;
  hours: number | null;
  worker: string;
  details: string | null;
  start: string | null;
  stop: string | null;
  professionalId: string | null;
  use: 'matched' | 'linked' | 'suggested' | 'unbilled' | 'outside_period' | 'unreadable';
  invoiceLineId: string | null;
  // Stop minus start, when it disagrees with the hours.
  clockHours: number | null;
}

// Column positions, from 0; time spent is in `hours` or else `minutes`.
export type TimeLogColumns = Partial<Record<'date' | 'hours' | 'minutes' | 'worker' | 'details' | 'entryId' | 'start' | 'stop', number>>;

export interface TimeLogCheck {
  fileName: string;
  uploadedAt: string;
  blocksApproval: boolean;
  headers: string[];
  columns: TimeLogColumns;
  period: { start: string; end: string } | null;
  lines: Array<{ invoiceLineId: string; status: TimeLogLineStatus; entryKeys: string[]; loggedHours: number | null; flagged: boolean }>;
  entries: TimeLogEntryCheck[];
  workers: Array<{
    name: string;
    entryCount: number;
    professionalId: string | null;
    notAPerson: boolean;
    automatic: boolean;
    suggestedProfessionalId: string | null;
  }>;
  dailyTotals: Array<{ date: string; professionalId: string; billed: number; logged: number }>;
}

export const NOT_A_PERSON = 'not_a_person';

// Without columns they're found by header; if they can't be, the headers come back.
export function uploadTimeLog(
  invoiceId: string,
  file: File,
  columns?: TimeLogColumns,
): Promise<{ needsColumns: true; headers: string[] } | { needsColumns: false }> {
  const query = columns ? `?${new URLSearchParams({ columns: JSON.stringify(columns) }).toString()}` : '';
  return request(`/api/invoices/${invoiceId}/time-log${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
}

export function setTimeLogColumns(invoiceId: string, columns: TimeLogColumns): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log/columns`, { method: 'PUT', body: JSON.stringify({ columns }) });
}

export function removeTimeLog(invoiceId: string): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log`, { method: 'DELETE' });
}

// match: a professional id, NOT_A_PERSON, or null to undo.
export function setTimeLogWorker(invoiceId: string, name: string, match: string | null): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log/worker`, { method: 'PUT', body: JSON.stringify({ name, match }) });
}

export function linkTimeLogEntries(invoiceId: string, invoiceLineId: string, entryKeys: string[]): Promise<unknown> {
  return request(`/api/invoices/${invoiceId}/time-log/lines/${invoiceLineId}`, { method: 'PUT', body: JSON.stringify({ entryKeys }) });
}
