// Server timestamps are raw ISO 8601 (e.g. "2026-08-18T10:24:13.465Z") —
// fine for sorting/transport, unreadable as table content. Renders in the
// viewer's locale/timezone, with no seconds/milliseconds.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Calendar dates ("2026-01-05") have no time zone; format them as UTC so
// the viewer's zone can't shift them by a day.
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return '—';
  }
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
}

export function formatPeriod(start: string | null, end: string | null): string {
  return start || end ? `${formatDate(start)} – ${formatDate(end)}` : '—';
}
