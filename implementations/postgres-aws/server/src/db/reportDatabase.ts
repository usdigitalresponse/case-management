import 'dotenv/config';
import { pool } from './client';
import { buildDatabaseReport } from './databaseReport';

async function main(): Promise<void> {
  process.stdout.write(`${await buildDatabaseReport(pool)}\n`);
  await pool.end();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
