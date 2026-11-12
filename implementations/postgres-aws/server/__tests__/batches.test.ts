// The list cursor (../src/lists/batches.ts): kept exact, and refused when changed.
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { afterCursor, batchRequest, cursorColumn, encodeCursor, newestFirst, sortKey, type SortKey } from '../src/lists/batches';
import { ValidationError } from '../src/errors';

afterAll(async () => {
  await testPool.end();
});

const keys: SortKey[] = [
  sortKey(sql`3`, 'integer'),
  newestFirst(sql`'2026-03-04 05:06:07.123456+00'::timestamptz`),
  sortKey(sql`'2026-03-04 05:06:07.123456+00'::timestamptz`, 'timestamptz'),
  sortKey(sql`'Name'`, 'text'),
  sortKey(sql`'7da36613-8efa-4be8-8837-b30d8c2cd3ab'::uuid`, 'uuid'),
];

describe('list cursors', () => {
  it('read back as Postgres wrote them compare equal, to the microsecond', async () => {
    const [row] = (await testDb.execute<{ cursor: string[] }>(sql`select ${cursorColumn(keys)} as cursor`)).rows;
    const after = batchRequest({ after: encodeCursor(row!.cursor) }).after;
    const [compared] = (await testDb.execute<{ after: boolean; equal: boolean }>(sql`select ${afterCursor(keys, after)} as after`)).rows;
    expect(compared?.after).toBe(false);
  });

  it('refuses one that was changed, whatever the part', () => {
    const good = ['3', '-1772600767.123456', '2026-03-04 05:06:07.123456+00', 'Name', '7da36613-8efa-4be8-8837-b30d8c2cd3ab'];
    expect(() => afterCursor(keys, good)).not.toThrow();
    for (const [index, bad] of [[0, 'x'], [1, '1e9'], [2, 'yesterday'], [4, 'not-a-uuid']] as const) {
      const changed = [...good];
      changed[index] = bad;
      expect(() => afterCursor(keys, changed), bad).toThrow(ValidationError);
    }
    expect(() => afterCursor(keys, good.slice(1))).toThrow(ValidationError);
    expect(() => batchRequest({ after: 'not base64 json' })).toThrow(ValidationError);
    expect(() => batchRequest({ limit: '500' })).toThrow(ValidationError);
  });
});
