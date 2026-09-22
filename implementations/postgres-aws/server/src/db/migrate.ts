import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: './migrations' });
  await pool.end();
  // eslint-disable-next-line no-console
  console.log('Migrations applied.');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
