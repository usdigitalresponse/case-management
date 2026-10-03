// Lookups for reference rows that ./ensureReferenceData.ts (or, for
// test/dev-only codes, ./fixtures.ts) provisions — a plain lookup, never a
// lazy create-on-first-use, so each row has one provisioning mechanism. A
// missing row is a deployment problem, reported as a ConfigurationError.
import { and, eq, getTableName } from 'drizzle-orm';
import type { Database } from './client';
import { role, type ReferenceTable } from './schema';
import { ConfigurationError } from '../errors';

export async function getReferenceId(db: Database, table: ReferenceTable, code: string): Promise<string> {
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.code, code));
  if (!row) {
    throw new ConfigurationError(`Missing required ${getTableName(table)} row with code "${code}".`);
  }
  return row.id;
}

export async function getSeededRoleId(db: Database, displayName: string, roleContext: string): Promise<string> {
  const [row] = await db
    .select({ roleId: role.roleId })
    .from(role)
    .where(and(eq(role.displayName, displayName), eq(role.roleContext, roleContext)));
  if (!row) {
    throw new ConfigurationError(`Missing required role "${displayName}" (role_context ${roleContext}).`);
  }
  return row.roleId;
}
