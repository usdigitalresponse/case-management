// Synthetic reporting zone pending per-organization configuration
// (docs/intake.md). Shared by ./intake/createCase.ts (opening) and
// ./cases/closeCase.ts (closing) — both need to turn an exact instant
// into the calendar date a case's opened_on/closed_on columns store.
const REPORTING_TIME_ZONE = 'UTC';

// Built once: making a formatter costs far more than using one.
const CALENDAR_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: REPORTING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const TIME_OF_DAY = new Intl.DateTimeFormat('en-US', { timeZone: REPORTING_TIME_ZONE, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

export function calendarDateInReportingTimeZone(date: Date): string {
  return CALENDAR_DATE.format(date);
}

// The time of day in the reporting zone, named, for messages such as receipts.
export function timeInReportingTimeZone(date: Date): string {
  return TIME_OF_DAY.format(date);
}
