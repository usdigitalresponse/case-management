import 'dotenv/config';
import { createDb } from '../src/db/client';

// Requires a running Postgres with migrations already applied — see
// ../../README.md ("Running tests") for local setup.
const connectionString =
  process.env.TEST_DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/case_management_postgres_aws_test';

export const { pool: testPool, db: testDb } = createDb(connectionString);
