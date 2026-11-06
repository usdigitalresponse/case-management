// County choices (model/rules.yaml record_case_county), as the picker
// (components/CountyPicker.tsx) offers them.
import type { CountyChoice, CountyOption } from './api/client';

// countyId null: a county typed in, added when it is saved.
export interface CountyValue {
  countyId: string | null;
  displayName: string;
}

// As the server matches names: case, spacing, punctuation and the word
// "county" don't count.
export function countyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bcounty\b/g, ' ')
    .replace(/^\s*of\b/, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

// Settings such as post-conviction first, then counties, each matching what
// is typed; and the name to add when nothing listed has it.
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

// A list's county control (components/CountyListControl.tsx): every row,
// every row grouped by county, only those with no county, or one county's.
export const ALL_COUNTIES = 'all';
export const GROUPED_BY_COUNTY = 'grouped';
export const NO_COUNTY = 'none';

export interface CountyRow {
  countyId: string | null;
  displayName?: string | null;
}

// Rows in their order, or grouped: settings first, then counties by name,
// then those with none. Each group keeps the list's own order.
export function applyCountyControl<T>(rows: T[], countyOf: (row: T) => CountyRow, choice: string, options: CountyOption[]): T[] {
  if (choice === ALL_COUNTIES) return rows;
  if (choice === NO_COUNTY) return rows.filter((row) => !countyOf(row).countyId);
  if (choice !== GROUPED_BY_COUNTY) return rows.filter((row) => countyOf(row).countyId === choice);
  // Counties no longer listed come after the rest, each kept together.
  const unlisted = [...new Set(rows.map((row) => countyOf(row).countyId))].filter(
    (countyId): countyId is string => Boolean(countyId) && !options.some((option) => option.countyId === countyId),
  );
  const rank = (row: T) => {
    const { countyId } = countyOf(row);
    if (!countyId) return options.length + unlisted.length;
    const index = options.findIndex((option) => option.countyId === countyId);
    return index < 0 ? options.length + unlisted.indexOf(countyId) : index;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

// What the control offers: every setting, the counties the rows have, and
// the one chosen even when no row has it now, each with how many rows have it.
export function countyControlOptions<T>(
  rows: T[],
  countyOf: (row: T) => CountyRow,
  options: CountyOption[],
  chosen?: string,
): { settings: Array<CountyOption & { count: number }>; counties: Array<CountyOption & { count: number }>; none: number } {
  const counts = new Map<string, number>();
  const unlisted = new Map<string, string>();
  for (const row of rows) {
    const { countyId, displayName } = countyOf(row);
    if (!countyId) continue;
    counts.set(countyId, (counts.get(countyId) ?? 0) + 1);
    if (!options.some((option) => option.countyId === countyId)) unlisted.set(countyId, displayName ?? 'Unlisted county');
  }
  const withCount = (option: CountyOption) => ({ ...option, count: counts.get(option.countyId) ?? 0 });
  return {
    settings: options.filter((option) => !option.isCounty).map(withCount),
    counties: [
      ...options.filter((option) => option.isCounty && (counts.has(option.countyId) || option.countyId === chosen)),
      ...[...unlisted].map(([countyId, displayName]) => ({ countyId, displayName, isCounty: true })),
    ].map(withCount),
    none: rows.filter((row) => !countyOf(row).countyId).length,
  };
}

export function countyChoiceOf(value: CountyValue | null): CountyChoice {
  if (!value) return { countyId: null };
  return value.countyId ? { countyId: value.countyId } : { countyName: value.displayName };
}

export function countyValueOf(invoice: { countyId: string | null; countyDisplayName: string | null }): CountyValue | null {
  return invoice.countyId && invoice.countyDisplayName ? { countyId: invoice.countyId, displayName: invoice.countyDisplayName } : null;
}
