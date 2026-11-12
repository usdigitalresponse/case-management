// Rows grouped by a key, in order, for lookups inside a loop.
export function groupBy<T, K>(rows: T[], keyOf: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const own = grouped.get(key);
    if (own) own.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}
