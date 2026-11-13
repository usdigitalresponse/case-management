// Long lists sent a batch at a time, in a fixed order, continuing after the
// last row sent (a cursor), so rows added meanwhile never repeat or shift.
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { ValidationError } from '../errors';

export const BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;

export interface BatchRequest {
  limit: number;
  // The last row sent's sort keys; null for the first batch.
  after: string[] | null;
}

export interface Batch<T> {
  items: T[];
  // Pass back as `after` for the next batch; null after the last.
  next: string | null;
}

export function batchRequest(query: Record<string, unknown>): BatchRequest {
  const limit = typeof query.limit === 'string' ? Number(query.limit) : BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new ValidationError({ limit: `Ask for 1 to ${MAX_BATCH_SIZE} rows at a time.` });
  }
  return { limit, after: typeof query.after === 'string' && query.after !== '' ? decodeCursor(query.after) : null };
}

export function encodeCursor(keys: string[]): string {
  return Buffer.from(JSON.stringify(keys)).toString('base64url');
}

function decodeCursor(cursor: string): string[] {
  try {
    const keys: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (Array.isArray(keys) && keys.length > 0 && keys.every((key) => typeof key === 'string')) return keys;
  } catch {
    // Reported below.
  }
  throw new ValidationError({ after: 'That list position is not valid. Reload the list.' });
}

// A sort key, compared as `type` and read back as exact text for the cursor; never null.
// Keys sort ascending, so the whole order is one row comparison; see `newestFirst`.
export interface SortKey {
  value: SQL;
  type: 'text' | 'timestamptz' | 'numeric' | 'integer' | 'uuid';
}

export const sortKey = (value: SQL, type: SortKey['type']): SortKey => ({ value, type });

// A time sorted latest first, with no time last.
export const newestFirst = (time: SQL | AnyColumn): SortKey => sortKey(sql`coalesce(-extract(epoch from ${time}), 'Infinity'::numeric)`, 'numeric');

// A time sorted earliest first, with no time last.
export const oldestFirst = (time: SQL | AnyColumn): SortKey => sortKey(sql`coalesce(${time}, 'infinity'::timestamptz)`, 'timestamptz');

// What each type's text must look like, so a changed cursor is refused here, not by Postgres.
const VALID: Record<SortKey['type'], (value: string) => boolean> = {
  text: () => true,
  integer: (value) => /^-?\d{1,9}$/.test(value),
  numeric: (value) => /^-?\d+(\.\d+)?$/.test(value) || value === 'Infinity',
  uuid: (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  // As Postgres writes it ("2026-03-04 05:06:07.123456+00"); JavaScript reads the offset only with its minutes.
  timestamptz: (value) =>
    value === 'infinity' ||
    value === '-infinity' ||
    (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:\d{2})?$/.test(value) &&
      !Number.isNaN(Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')))),
};

// Rows after the cursor's.
export function afterCursor(keys: SortKey[], after: string[] | null): SQL | undefined {
  if (!after) return undefined;
  if (after.length !== keys.length || after.some((value, index) => !VALID[keys[index]!.type](value))) {
    throw new ValidationError({ after: 'That list position is not valid. Reload the list.' });
  }
  const row = sql.join(keys.map((key) => key.value), sql`, `);
  const values = sql.join(after.map((value, index) => sql`${value}::${sql.raw(keys[index]!.type)}`), sql`, `);
  return sql`(${row}) > (${values})`;
}

export function orderByKeys(keys: SortKey[]): SQL[] {
  return keys.map((key) => sql`${key.value} asc`);
}

// The keys as text, selected with each row to make its cursor.
export function cursorColumn(keys: SortKey[]): SQL<string[]> {
  return sql<string[]>`array[${sql.join(
    keys.map((key) => sql`${key.value}::text`),
    sql`, `,
  )}]`;
}

// A row as sent: its cursor is only for making `next`.
export function withoutCursor<Row extends { cursor: unknown }>({ cursor: _cursor, ...row }: Row): Omit<Row, 'cursor'> {
  return row;
}

// One batch of `limit` rows, reading one more to know whether more follow. Rows carry their cursorColumn (null
// only where read without one) and come back without it.
export async function oneBatch<Row extends { cursor: string[] | null }>(
  request: BatchRequest,
  read: (after: string[] | null, limit: number) => Promise<Row[]>,
): Promise<{ rows: Array<Omit<Row, 'cursor'>>; next: string | null }> {
  const rows = await read(request.after, request.limit + 1);
  const more = rows.length > request.limit;
  const kept = more ? rows.slice(0, request.limit) : rows;
  return { rows: kept.map(withoutCursor), next: more ? encodeCursor(kept[kept.length - 1]!.cursor!) : null };
}

// For a filter only code can apply: reads on in batches until `limit` rows are kept or none are left.
export async function filledBatch<Row extends { cursor: string[] | null }, Item>(
  request: BatchRequest,
  read: (after: string[] | null, limit: number) => Promise<Row[]>,
  expand: (rows: Array<Omit<Row, 'cursor'>>) => Promise<Item[]>,
  keep: (item: Item) => boolean,
  // Rows read at a time; more than the batch when few are kept.
  readSize = request.limit,
): Promise<Batch<Item>> {
  const items: Item[] = [];
  let after = request.after;
  for (;;) {
    // Each read starts after the last; only as many as it takes to fill the batch.
    // eslint-disable-next-line no-await-in-loop
    const rows = await read(after, readSize);
    // eslint-disable-next-line no-await-in-loop
    const expanded = await expand(rows.map(withoutCursor));
    for (const [index, item] of expanded.entries()) {
      if (!keep(item)) continue;
      items.push(item);
      if (items.length === request.limit) {
        const last = index === rows.length - 1 && rows.length < readSize;
        return { items, next: last ? null : encodeCursor(rows[index]!.cursor!) };
      }
    }
    if (rows.length < readSize) return { items, next: null };
    after = rows[rows.length - 1]!.cursor!;
  }
}
