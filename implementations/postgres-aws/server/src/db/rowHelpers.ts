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

// Drizzle wraps PostgreSQL errors in .cause. Shared by every caller that
// needs to recover from a concurrent-write race by re-reading instead of
// failing (../intake/createCase.ts, ../professionals/ensureProfessional.ts,
// ../routes/cases.ts's external-assignment route).
export function uniqueViolationConstraint(error: unknown): string | null {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === '23505'
    ) {
      return (candidate as { constraint?: string }).constraint ?? '';
    }
  }
  return null;
}
