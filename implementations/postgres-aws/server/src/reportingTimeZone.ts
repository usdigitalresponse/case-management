// Synthetic reporting zone pending per-organization configuration
// (MAPPING.md). Shared by ./intake/createCase.ts (opening) and
// ./cases/closeCase.ts (closing) — both need to turn an exact instant
// into the calendar date a case's opened_on/closed_on columns store.
const REPORTING_TIME_ZONE = 'UTC';

export function calendarDateInReportingTimeZone(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
