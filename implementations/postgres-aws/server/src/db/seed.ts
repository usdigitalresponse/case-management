import 'dotenv/config';
import { pool } from './client';
import { resetToDemoData } from './demoData';

async function main(): Promise<void> {
  const { caseCount, assignmentCount, staffCount } = await resetToDemoData();
  // eslint-disable-next-line no-console
  console.log(
    `Seed complete (${caseCount} demo cases, ${assignmentCount} external assignments with time/invoices, ` +
      `${staffCount} demo staff, 1 closed).`,
  );
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
