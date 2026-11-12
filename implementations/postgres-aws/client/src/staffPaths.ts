// Staff pages linked to from several places.
export function searchPath(query: string): string {
  return `/search?${new URLSearchParams({ q: query }).toString()}`;
}

export function personPath(professionalId: string): string {
  return `/people/${professionalId}`;
}

export function reviewPath(invoiceId: string): string {
  return `/billing/${invoiceId}`;
}

export const MERGE_PEOPLE_PATH = '/people/merge';

// People's Review duplicates tab, with any of its own parameters, such as `merged`.
export function duplicatePeoplePath(params: Record<string, string> = {}): string {
  return `/people?${new URLSearchParams({ tab: 'duplicates', ...params }).toString()}`;
}

export function mergePath(keptPersonId: string, retiredPersonIds: string[]): string {
  return `${MERGE_PEOPLE_PATH}?${new URLSearchParams({ keep: keptPersonId, retire: retiredPersonIds.join(',') }).toString()}`;
}
