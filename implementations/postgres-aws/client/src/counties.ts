// County choices for the pickers and list controls (model/rules.yaml record_case_county).
import type { CountyChoice, CountyCount, CountyOption } from './api/client';

// countyId null: a county typed in, added when it is saved.
export interface CountyValue {
  countyId: string | null;
  displayName: string;
}

// Matches server/src/cases/counties.ts countyKey.
export function countyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bcounty\b/g, ' ')
    .replace(/^\s*of\b/, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

// Settings first; addName is offered when nothing listed has the typed name.
export function countyMatches(options: CountyOption[], query: string): { matches: CountyOption[]; addName: string | null } {
  const typed = query.trim().replace(/\s+/g, ' ');
  const key = countyKey(typed);
  const matching = key
    ? options.filter((option) => countyKey(option.displayName).includes(key) || option.displayName.toLowerCase().includes(typed.toLowerCase()))
    : options;
  return {
    matches: [...matching.filter((option) => !option.isCounty), ...matching.filter((option) => option.isCounty)],
    addName: key && !options.some((option) => countyKey(option.displayName) === key) ? typed : null,
  };
}

// The list control's choices besides one county's id.
export const ALL_COUNTIES = 'all';
export const GROUPED_BY_COUNTY = 'grouped';
export const NO_COUNTY = 'none';

// Every setting, the counties with rows and the chosen one even with none,
// with the server's counts (null: not known, so every county is offered).
export function countyControlOptions(
  counts: CountyCount[] | null,
  options: CountyOption[],
  chosen?: string,
): { settings: CountyOffer[]; counties: CountyOffer[]; none: number | null } {
  const countOf = new Map((counts ?? []).flatMap((row) => (row.countyId ? [[row.countyId, row.count] as const] : [])));
  const withCount = (option: CountyOption) => ({ ...option, count: counts ? (countOf.get(option.countyId) ?? 0) : null });
  const unlisted = (counts ?? []).filter((row) => row.countyId && !options.some((option) => option.countyId === row.countyId));
  return {
    settings: options.filter((option) => !option.isCounty).map(withCount),
    counties: [
      ...options.filter((option) => option.isCounty && (!counts || countOf.has(option.countyId) || option.countyId === chosen)),
      ...unlisted.map((row) => ({ countyId: row.countyId!, displayName: row.displayName ?? 'Unlisted county', isCounty: true })),
    ].map(withCount),
    none: counts ? (counts.find((row) => !row.countyId)?.count ?? 0) : null,
  };
}

export type CountyOffer = CountyOption & { count: number | null };

export function countyChoiceOf(value: CountyValue | null): CountyChoice {
  if (!value) return { countyId: null };
  return value.countyId ? { countyId: value.countyId } : { countyName: value.displayName };
}

export function countyValueOf(invoice: { countyId: string | null; countyDisplayName: string | null }): CountyValue | null {
  return invoice.countyId && invoice.countyDisplayName ? { countyId: invoice.countyId, displayName: invoice.countyDisplayName } : null;
}
