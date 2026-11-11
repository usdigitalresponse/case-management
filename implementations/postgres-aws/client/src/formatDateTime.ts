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

// The design's date: day, short month, year ("3 Aug 2026"); null for an invalid date.
function dayMonthYear(date: Date, timeZone?: string): string | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = Object.fromEntries(dayMonthYearFormat(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}`;
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

export function formatPeriod(start: string | null, end: string | null): string {
  return start || end ? `${formatDate(start)} – ${formatDate(end)}` : '—';
}

// A timestamp's date in the viewer's zone, so an evening submission isn't shown as the next day.
export function formatDay(iso: string, timeZone?: string): string {
  return dayMonthYear(new Date(iso), timeZone) ?? iso;
}
