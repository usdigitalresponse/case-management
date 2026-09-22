import 'dotenv/config';
import { db, pool } from './client';
import { resetAndSeedBaselineFixtures } from './fixtures';

async function main(): Promise<void> {
  await resetAndSeedBaselineFixtures(db);
  // eslint-disable-next-line no-console
  console.log('Seed complete.');
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
