import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Every connection's pool and drizzle config: the app's, migrations' and tests'.
export function createDb(connectionString: string) {
  // Without JIT: compiling this app's short queries takes longer than running them (hundreds of ms against tens).
  const pool = new Pool({ connectionString, options: '-c jit=off' });
  return { pool, db: drizzle(pool, { schema }) };
}

const { pool, db } = createDb(
  process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/case_management_postgres_aws',
);

export { pool, db };
export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
// For helpers that work both standalone and inside a caller's transaction.
export type DatabaseOrTransaction = Database | Transaction;
