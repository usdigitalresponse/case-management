// A single-row result, narrowed from possibly undefined.
export function firstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) {
    throw new Error('Expected a query to return at least one row.');
  }
  return row;
}

// For recovering from a concurrent-write race; Drizzle wraps PostgreSQL errors in .cause.
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
