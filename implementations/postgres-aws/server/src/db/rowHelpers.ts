// `.returning()`/insert helpers share this narrowing so a single-row result
// isn't left as possibly-undefined (noUncheckedIndexedAccess) throughout
// callers.
export function firstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) {
    throw new Error('Expected a query to return at least one row.');
  }
  return row;
}
