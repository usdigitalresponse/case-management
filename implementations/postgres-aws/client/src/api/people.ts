import { request } from './http';
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

export function searchPeople(query: string): Promise<{ people: PersonRecord[] }> {
  return request<{ people: PersonRecord[] }>(`/api/people?q=${encodeURIComponent(query)}`);
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

export interface PossibleDuplicate {
  people: [DuplicatePerson, DuplicatePerson];
  reasons: DuplicateReason[];
  flagged: { note: string | null; byDisplayName: string; at: string } | null;
}

export function listPossibleDuplicates(): Promise<{ duplicates: PossibleDuplicate[] }> {
  return request('/api/people/possible-duplicates');
}

export function reviewPossibleDuplicate(input: { personIds: [string, string]; outcome: 'possible_duplicate' | 'not_duplicate'; note?: string }) {
  return request<void>('/api/people/possible-duplicates', { method: 'POST', body: JSON.stringify(input) });
}

export interface MergePreview {
  kept: DuplicatePerson;
  retired: DuplicatePerson;
  moves: Array<{ label: string; count: number }>;
  // The kept record's empty details, taken from the other.
  filledIn: Array<{ label: string; value: string }>;
  notMoved: string[];
  // Why it can't be merged yet; empty when it can.
  blockers: string[];
}

export function getMergePreview(keptPersonId: string, retiredPersonId: string): Promise<MergePreview> {
  return request(`/api/people/merge-preview?keep=${encodeURIComponent(keptPersonId)}&retire=${encodeURIComponent(retiredPersonId)}`);
}

export interface PersonMerge {
  personMergeId: string;
  kept: { personId: string; displayName: string };
  retired: { personId: string; displayName: string };
  note: string | null;
  mergedAt: string;
  mergedBy: string;
  undoneAt: string | null;
  changeCount: number;
}

export function listPersonMerges(): Promise<{ merges: PersonMerge[] }> {
  return request('/api/people/merges');
}

export function mergePeople(input: { keptPersonId: string; retiredPersonId: string; note?: string }): Promise<{ personMergeId: string; changed: number }> {
  return request('/api/people/merges', { method: 'POST', body: JSON.stringify(input) });
}

// Puts back what the merge moved; anything changed since stays as it is.
export function undoPersonMerge(personMergeId: string): Promise<{ restored: number; leftAsIs: number }> {
  return request(`/api/people/merges/${personMergeId}/undo`, { method: 'POST', body: '{}' });
}
