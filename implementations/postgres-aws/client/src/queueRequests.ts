// Each invoice list's request from its address, shared by its page and route
// loader so both load the same batches.
import type { QueueRequest, QueueShow, QueueSort } from './api/client';
import { ALL_COUNTIES } from './counties';
import { QUEUE_FILTERS, type QueueFilterId } from './queueFilters';

export const TO_REVIEW_SORTS = [
  { id: 'waiting', label: 'Waiting longest first' },
  { id: 'newest', label: 'Newest first' },
] as const;
export type ToReviewSortId = (typeof TO_REVIEW_SORTS)[number]['id'];

// Neutral, as in design I29.
export const FINISHED_FILTERS = [
  { id: 'month', label: 'This month' },
  { id: 'sign_off', label: 'Waiting for sign-off' },
  { id: 'decided', label: 'Signed off' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
] as const;
export type FinishedFilterId = (typeof FINISHED_FILTERS)[number]['id'];

const choice = <T extends string>(params: URLSearchParams, name: string, allowed: readonly { id: T }[], fallback: T): T => {
  const value = params.get(name);
  return allowed.some((option) => option.id === value) ? (value as T) : fallback;
};

// The county list's choice, as the server takes it.
export function countyParam(params: URLSearchParams): string | undefined {
  const county = params.get('county');
  return county && county !== ALL_COUNTIES ? county : undefined;
}

export const queueShowOf = (filter: QueueFilterId): QueueShow => (filter === 'everyone' ? 'all' : filter);

export function toReviewRequest(params: URLSearchParams): QueueRequest {
  return {
    view: 'open',
    show: queueShowOf(choice(params, 'show', QUEUE_FILTERS, 'everyone')),
    sort: choice<ToReviewSortId>(params, 'sort', TO_REVIEW_SORTS, 'waiting') as QueueSort,
    county: countyParam(params),
    counts: QUEUE_FILTERS.map(({ id }) => queueShowOf(id)),
  };
}

export function finishedRequest(params: URLSearchParams): QueueRequest {
  return {
    view: 'lines_decided',
    show: choice(params, 'show', FINISHED_FILTERS, 'month'),
    sort: 'finished',
    county: countyParam(params),
    counts: FINISHED_FILTERS.map(({ id }) => id),
  };
}

// The earlier case-led queue, by address only: To review led by "Assigned to you", or the decided.
export function alternateRequest(view: 'open' | 'finished', params: URLSearchParams): QueueRequest {
  return {
    view,
    show: view === 'open' ? queueShowOf(choice(params, 'show', QUEUE_FILTERS, 'mine')) : 'all',
    sort: 'waiting',
    q: params.get('q') ?? undefined,
    county: countyParam(params),
    counts: view === 'open' ? QUEUE_FILTERS.map(({ id }) => queueShowOf(id)) : [],
  };
}

// Signed-off invoices, latest first.
export function exportsRequest(params: URLSearchParams): QueueRequest {
  return { view: 'finished', show: 'approved', sort: 'finished', county: countyParam(params) };
}

// Search: exact matches first, newest first.
export function searchRequest(params: URLSearchParams): QueueRequest {
  return { view: 'all', q: params.get('q')?.trim() ?? '', sort: 'search', county: countyParam(params) };
}

export const PERSON_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'decided', label: 'Signed off' },
] as const;
export type PersonFilterId = (typeof PERSON_FILTERS)[number]['id'];

export const personShowOf = (filter: PersonFilterId): QueueShow => (filter === 'decided' ? 'done' : filter);

// A person's invoices, newest first; ?day= only those with an item that date; caseNumber typed into its filter.
export function personRequest(professionalId: string, params: URLSearchParams, caseNumber = ''): QueueRequest {
  const day = params.get('day') ?? '';
  return {
    view: 'all',
    professionalId,
    day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined,
    show: personShowOf(choice(params, 'show', PERSON_FILTERS, 'all')),
    sort: 'newest',
    q: caseNumber.trim() || undefined,
    county: countyParam(params),
    counts: PERSON_FILTERS.map(({ id }) => personShowOf(id)),
  };
}
