import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

// One array parameter instead of inArray's one per id: far cheaper for long lists.
export function inIds(column: AnyColumn, ids: string[]): SQL {
  return ids.length === 0 ? sql`false` : sql`${column} = any(${sql.param(ids)}::uuid[])`;
}
