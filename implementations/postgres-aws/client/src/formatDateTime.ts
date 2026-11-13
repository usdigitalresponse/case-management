const formats = new Map<string, Intl.DateTimeFormat>();
const dayMonthYearFormat = (timeZone: string | undefined) => {
  const key = timeZone ?? '';
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
    formats.set(key, format);
  }
  return format;
};

function partsOf(date: Date, timeZone?: string): Record<string, string> | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Object.fromEntries(dayMonthYearFormat(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
}

// The American date, as in design K: short month, day, year ("Aug 3, 2026"); null for an invalid date.
function dayMonthYear(date: Date, timeZone?: string): string | null {
  const parts = partsOf(date, timeZone);
  return parts ? `${parts.month} ${parts.day}, ${parts.year}` : null;
}

// Server timestamps are raw ISO 8601; shown as the viewer's local date and time, without seconds.
export function formatDateTime(iso: string): string {
  const when = new Date(iso);
  const day = dayMonthYear(when);
  return day ? `${day}, ${when.toLocaleTimeString(undefined, { timeStyle: 'short' })}` : iso;
}

// Calendar dates ("2026-01-05") have no time zone; format them as UTC so
// the viewer's zone can't shift them by a day. Anything unreadable is shown as given.
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return '—';
  }
  return dayMonthYear(new Date(`${isoDate}T00:00:00Z`), 'UTC') ?? isoDate;
}

// "Feb 1 to 28, 2026", "Jan 30 to Feb 2, 2026" or "Dec 15, 2025 to Jan 10, 2026".
export function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) {
    return start || end ? `${formatDate(start)} to ${formatDate(end)}` : '—';
  }
  const from = partsOf(new Date(`${start}T00:00:00Z`), 'UTC');
  const to = partsOf(new Date(`${end}T00:00:00Z`), 'UTC');
  if (!from || !to || from.year !== to.year) {
    return `${formatDate(start)} to ${formatDate(end)}`;
  }
  const last = from.month === to.month ? to.day : `${to.month} ${to.day}`;
  return `${from.month} ${from.day} to ${last}, ${to.year}`;
}

// A timestamp's date in the viewer's zone, so an evening submission isn't shown as the next day.
export function formatDay(iso: string, timeZone?: string): string {
  return dayMonthYear(new Date(iso), timeZone) ?? iso;
}
