import { calendarDateInReportingTimeZone, timeInReportingTimeZone } from './reportingTimeZone';

const dayMonthYear = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// A calendar date ("2026-09-04") as the design writes it: "Sep 4, 2026"; anything unreadable as given.
export function formatCalendarDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  const parts = Object.fromEntries(dayMonthYear.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.month} ${parts.day}, ${parts.year}`;
}

// A zone the sender's browser named, if Intl knows it.
function knownZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

// In the given zone if known, else the reporting zone: "Nov 10, 2026, 9:14 PM PST".
export function formatInstant(instant: Date, timeZone?: string): string {
  const zone = knownZone(timeZone);
  if (!zone) {
    return `${formatCalendarDate(calendarDateInReportingTimeZone(instant))}, ${timeInReportingTimeZone(instant)}`;
  }
  const calendarDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(instant);
  return `${formatCalendarDate(calendarDate)}, ${time}`;
}
