// Rows grouped by their case, in order, for lookups inside a loop over cases.
export function byCase<T extends { caseId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const own = grouped.get(row.caseId);
    if (own) own.push(row);
    else grouped.set(row.caseId, [row]);
  }
  return grouped;
}
