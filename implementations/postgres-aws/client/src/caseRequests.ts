// Each case or people list's request from its address, shared by its page and route loader.
import type { CaseRequest, CaseStage, PeopleRequest } from './api/client';
import { overviewStages } from './overviewStages';
import { countyParam } from './queueRequests';

export const CASE_SHOWS = ['all', 'open', 'closed'] as const;
export type CaseShow = (typeof CASE_SHOWS)[number];

// All cases; ?stage=<id> narrows to one stage (the Case overview's "View all" links set it).
export function caseListRequest(params: URLSearchParams): CaseRequest {
  const show = params.get('show');
  const stage = params.get('stage');
  return {
    show: CASE_SHOWS.find((value) => value === show) ?? 'all',
    stage: overviewStages.find((option) => option.id === stage)?.id as CaseStage | undefined,
    county: countyParam(params),
    q: params.get('q')?.trim() || undefined,
  };
}

// Clients: every case's client, searched by name or case number.
export function clientsRequest(params: URLSearchParams): CaseRequest {
  return { q: params.get('q')?.trim() || undefined };
}

// People: by role ('none' for those without one) and name or email.
export function peopleRequest(params: URLSearchParams): PeopleRequest {
  return { role: params.get('role') || undefined, q: params.get('q')?.trim() || undefined };
}

// Design K54's three filters; the server groups the statuses.
export const REQUEST_STATUS_TABS = ['all', 'in_review', 'decided'] as const;
export type RequestStatusTab = (typeof REQUEST_STATUS_TABS)[number];

// Links from before design K named one status.
const OLD_STATUS_TABS: Record<string, RequestStatusTab> = {
  submitted: 'in_review',
  info_requested: 'in_review',
  approved: 'decided',
  not_needed: 'decided',
  denied: 'decided',
  withdrawn: 'decided',
};

// The Pre-authorizations page's filter; an unknown status opens on All.
export function preauthorizationRequestsRequest(params: URLSearchParams) {
  const asked = params.get('status') ?? '';
  const tab = REQUEST_STATUS_TABS.find((id) => id === asked) ?? OLD_STATUS_TABS[asked] ?? 'all';
  return { tab, filter: { status: tab === 'all' ? '' : tab, countyId: params.get('countyId') ?? undefined, caseId: params.get('caseId') ?? undefined } };
}
