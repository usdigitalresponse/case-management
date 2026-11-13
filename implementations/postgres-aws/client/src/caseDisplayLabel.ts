// A case link's label: its client or reference, else a date, never the raw id.
export function caseDisplayLabel(
  candidates: Array<string | null | undefined>,
  dateFallback: { label: string; date: string | null } | undefined,
): string {
  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }
  if (dateFallback?.date) {
    return `${dateFallback.label} ${dateFallback.date.slice(0, 10)}`;
  }
  return 'Unnamed case';
}
