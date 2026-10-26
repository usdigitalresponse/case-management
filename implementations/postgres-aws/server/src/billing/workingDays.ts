// Waiting time in working days (model/rules.yaml measure_review_waiting).
// Weekends are skipped; a holiday calendar is planned, not built.
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

// Working days after the day of `from` up to and including the day of `to`:
// submitted on a Friday, it has waited one working day on Monday.
export function workingDaysBetween(from: Date, to: Date): number {
  const start = utcDay(calendarDateInReportingTimeZone(from));
  const end = utcDay(calendarDateInReportingTimeZone(to));
  let days = 0;
  for (let day = start + DAY_MS; day <= end; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days += 1;
    }
  }
  return days;
}
