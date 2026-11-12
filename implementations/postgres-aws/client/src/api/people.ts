import { request } from './http';
import { batchParams, type Batch } from './batches';
import type { ProfessionalRate } from './myInvoices';
import type { AssignedPerson } from './reviewQueue';

export interface PersonRecord {
  personId: string;
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  displayName: string;
  dateOfBirth: string | null;
  email: string | null;
}

// By name, a batch at a time.
export function searchPeople(query: string, after: string | null): Promise<Batch<PersonRecord>> {
  return request(`/api/people?${batchParams(new URLSearchParams({ q: query }), after)}`);
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
  officeDisplayName: string | null;
  // Billing delegates at their office, other than themselves.
  sentByDisplayNames: string[];
  // How many others they send invoices for, as a delegate.
  sendsForCount: number;
}

export interface PersonDetailsInput {
  phone?: string;
  paidThrough?: string;
  hourlyRate?: number;
  ratePerMile?: number;
  travelHourlyRate?: number;
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
  // Turned on in Settings → External users.
  externalSignInEnabled: boolean;
  phone: string | null;
  paidThrough: string | null;
  professionalKindId: string | null;
  role: string | null;
  // Today's, their own or else their role's and the general mileage rate.
  hourlyRate: string | null;
  ratePerMile: string | null;
  // Their own; null means the travel time setting applies.
  travelHourlyRate: string | null;
  waiting: { count: number; total: string };
  lastInvoiceAt: string | null;
}

// role: a kind's name, or 'none'; q: a name or email. By name, a batch at a time, with each role's count first.
export interface PeopleRequest {
  role?: string;
  q?: string;
}

export function listPeople(query: PeopleRequest, after: string | null): Promise<Batch<BillingPerson, { roles: Array<{ role: string | null; count: number }> }>> {
  const params = new URLSearchParams();
  if (query.role) params.set('role', query.role);
  if (query.q?.trim()) params.set('q', query.q.trim());
  return request(`/api/professionals/people?${batchParams(params, after)}`);
}

export type BillingPersonDetail = Omit<BillingPerson, 'waiting' | 'lastInvoiceAt'> & { reviewer: AssignedPerson | null };

export function getPerson(professionalId: string): Promise<BillingPersonDetail> {
  return request(`/api/professionals/people/${professionalId}`);
}

// By name, a batch at a time; limit as listReviewQueue's.
export function listVendors(query: string, after: string | null, limit?: number): Promise<Batch<VendorRecord>> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set('limit', String(limit));
  return request(`/api/professionals?${batchParams(params, after)}`);
}

// Providers matching what was typed, for a picker.
export async function searchProviders(query: string): Promise<VendorRecord[]> {
  return (await listVendors(query, null, 20)).items;
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

export function setProfessionalKind(professionalId: string, professionalKindId: string | null): Promise<unknown> {
  return request(`/api/professionals/${professionalId}/kind`, {
    method: 'PUT',
    body: JSON.stringify({ professionalKindId }),
  });
}

// A provider who hasn't signed in; they get this profile if they do later.
// givenName and familyName: the name's parts, when entered separately.
export function addProfessional(
  input: { displayName: string; email?: string; professionalKindId: string; givenName?: string; familyName?: string } & PersonDetailsInput,
) {
  return request<{ professionalId: string; displayName: string }>('/api/professionals', { method: 'POST', body: JSON.stringify(input) });
}

// --- Possible duplicate people (staff); merging them (administrators) -------

export type DuplicateReason = 'same_email' | 'same_name' | 'same_birth_date_and_family_name' | 'flagged';

export interface DuplicatePerson {
  personId: string;
  displayName: string;
  email: string | null;
  dateOfBirth: string | null;
  provider: { professionalId: string; kind: string | null; signInEmail: string | null } | null;
  caseCount: number;
  invoiceCount: number;
}

export interface DuplicatePair {
  personIds: [string, string];
  reasons: DuplicateReason[];
  flagged: { note: string | null; byDisplayName: string; at: string } | null;
}

// Everyone linked by any pair: likely one person recorded several times.
export interface PossibleDuplicate {
  people: DuplicatePerson[];
  pairs: DuplicatePair[];
}

export function listPossibleDuplicates(): Promise<{ duplicates: PossibleDuplicate[] }> {
  return request('/api/people/possible-duplicates');
}

export function reviewPossibleDuplicate(input: { personIds: [string, string]; outcome: 'possible_duplicate' | 'not_duplicate'; note?: string }) {
  return request<void>('/api/people/possible-duplicates', { method: 'POST', body: JSON.stringify(input) });
}

// What merging one record into the kept one would do.
export interface RetiredPlan {
  person: DuplicatePerson;
  moves: Array<{ label: string; count: number }>;
  // The kept record's empty details, taken from this one.
  filledIn: Array<{ label: string; value: string }>;
  notMoved: string[];
  // Why it can't be merged yet; empty when it can.
  blockers: string[];
}

// Each record in turn, as the merge would do it.
export interface MergePreview {
  kept: DuplicatePerson;
  retired: RetiredPlan[];
}

export function getMergePreview(keptPersonId: string, retiredPersonIds: string[]): Promise<MergePreview> {
  return request(`/api/people/merge-preview?${new URLSearchParams({ keep: keptPersonId, retire: retiredPersonIds.join(',') }).toString()}`);
}

export interface PersonMerge {
  personMergeId: string;
  kept: { personId: string; displayName: string };
  retired: { personId: string; displayName: string };
  note: string | null;
  mergedAt: string;
  mergedBy: string;
  undoneAt: string | null;
}

export function listPersonMerges(): Promise<{ merges: PersonMerge[] }> {
  return request('/api/people/merges');
}

// All or none.
export function mergePeople(input: { keptPersonId: string; retiredPersonIds: string[]; note?: string }): Promise<{ personMergeIds: string[] }> {
  return request('/api/people/merges', { method: 'POST', body: JSON.stringify(input) });
}

// In merge order; undone last first. Anything changed since stays as it is.
export function undoPersonMerges(personMergeIds: string[]): Promise<{ leftAsIs: number }> {
  return request('/api/people/merges/undo', { method: 'POST', body: JSON.stringify({ personMergeIds }) });
}
