import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Shared by the default (dev) connection below, migrate.ts, and
// __tests__/testDb.ts (test connection) — one place to change pool/drizzle
// config (SSL, pool size, logging) instead of three.
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { pool, db: drizzle(pool, { schema }) };
}

const { pool, db } = createDb(
  process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/case_management_postgres_aws',
);

export { pool, db };
export type Database = typeof db;
