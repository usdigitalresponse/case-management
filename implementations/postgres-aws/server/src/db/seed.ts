import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { db, pool } from './client';
import { resetAndSeedBaselineFixtures } from './fixtures';
import { person, caseCategories } from './schema';
import { createCase } from '../intake/createCase';
import { firstRow } from './rowHelpers';

// Dev/demo data only — deliberately not part of resetAndSeedBaselineFixtures,
// which __tests__/ also calls and relies on staying minimal (several tests
// assert zero pre-existing cases).
const DEMO_CASE_COUNT = 10;

async function seedDemoCases(fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>): Promise<void> {
  const categories = await db.select().from(caseCategories);

  for (let i = 0; i < DEMO_CASE_COUNT; i += 1) {
    const givenName = faker.person.firstName();
    const familyName = faker.person.lastName();
    // eslint-disable-next-line no-await-in-loop
    const demoPerson = firstRow(
      await db
        .insert(person)
        .values({ givenName, familyName, displayName: `${givenName} ${familyName}` })
        .returning(),
    );

    const category = categories[i % categories.length];
    if (!category) {
      throw new Error('Expected at least one case category to be seeded.');
    }

    // eslint-disable-next-line no-await-in-loop
    await createCase(
      db,
      { userAccountId: fixtures.staffUserAccountId },
      {
        requestId: randomUUID(),
        personId: demoPerson.personId,
        participantRoleId: fixtures.clientParticipantRoleId,
        statusId: fixtures.caseStatusOpenId,
        effectiveAt: faker.date.recent({ days: 180 }),
        countyId: fixtures.countyId,
        caseCategoryId: category.id,
      },
    );
  }
}

async function main(): Promise<void> {
  const fixtures = await resetAndSeedBaselineFixtures(db);
  await seedDemoCases(fixtures);
  // eslint-disable-next-line no-console
  console.log(`Seed complete (${DEMO_CASE_COUNT} demo cases).`);
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
