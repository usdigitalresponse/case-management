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

export const POSSIBLE_DUPLICATES_PATH = '/possible-duplicates';

export function mergePath(keptPersonId: string, retiredPersonId: string): string {
  return `${POSSIBLE_DUPLICATES_PATH}/merge?${new URLSearchParams({ keep: keptPersonId, retire: retiredPersonId }).toString()}`;
}
