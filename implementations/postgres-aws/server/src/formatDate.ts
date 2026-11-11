// A calendar date ("2026-09-04") as the design writes it: "4 Sep 2026".
export function formatCalendarDate(isoDate: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .formatToParts(new Date(`${isoDate}T00:00:00Z`))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}`;
}
