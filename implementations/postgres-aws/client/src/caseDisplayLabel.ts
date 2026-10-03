// clientDisplayName/externalReference are both optional, but a link to a
// case always needs something better than a raw caseId — fall through to
// the best candidate, then a date, never the id itself.
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
