import { calendarDateInReportingTimeZone, timeInReportingTimeZone } from './reportingTimeZone';

const dayMonthYear = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// A calendar date ("2026-09-04") as the design writes it: "4 Sep 2026"; anything unreadable as given.
export function formatCalendarDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  const parts = Object.fromEntries(dayMonthYear.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}`;
}

// An exact time as the design writes it, in the reporting zone: "4 Sep 2026, 5:14 PM UTC".
export function formatInstant(instant: Date): string {
  return `${formatCalendarDate(calendarDateInReportingTimeZone(instant))}, ${timeInReportingTimeZone(instant)}`;
}
