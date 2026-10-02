// Server timestamps are raw ISO 8601 (e.g. "2026-08-18T10:24:13.465Z") —
// fine for sorting/transport, unreadable as table content. Renders in the
// viewer's locale/timezone, with no seconds/milliseconds.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
