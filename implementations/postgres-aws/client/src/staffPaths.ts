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

// Settings' tabs, one section each (pages/Settings.tsx).
export const SETTINGS_TABS = ['review', 'people', 'rates', 'preauthorization', 'rules', 'providers', 'office-staff', 'duplicates', 'edit-data', 'demo'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function settingsPath(tab: SettingsTab, params: Record<string, string> = {}): string {
  return `/settings?${new URLSearchParams({ tab, ...params }).toString()}`;
}

// Settings › Merge duplicates (design K67).
export function duplicatesPath(params: Record<string, string> = {}): string {
  return settingsPath('duplicates', params);
}

export function mergePath(keptPersonId: string, retiredPersonIds: string[]): string {
  return `${MERGE_PEOPLE_PATH}?${new URLSearchParams({ keep: keptPersonId, retire: retiredPersonIds.join(',') }).toString()}`;
}
