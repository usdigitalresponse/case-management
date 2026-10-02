import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { db, pool } from './client';
import { resetAndSeedBaselineFixtures } from './fixtures';
import { person, caseCategories, caseAssignment, invoice } from './schema';
import { createCase } from '../intake/createCase';
import { createTimeEntry } from '../portal/createTimeEntry';
import { createInvoice } from '../portal/createInvoice';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { firstRow } from './rowHelpers';

// Dev/demo data only — deliberately not part of resetAndSeedBaselineFixtures,
// which __tests__/ also calls and relies on staying minimal (several tests
// assert zero pre-existing cases).
const DEMO_CASE_COUNT = 10;
const DEMO_PROFESSIONAL_COUNT = 3;
// How many demo cases get an external-submitter assignment; the rest stay unassigned.
const ASSIGNED_CASE_COUNT = 6;

async function seedDemoCases(fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>): Promise<string[]> {
  const categories = await db.select().from(caseCategories);
  const caseIds: string[] = [];

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
    const result = await createCase(
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
    caseIds.push(result.caseId);
  }

  return caseIds;
}

interface DemoProfessional {
  professionalId: string;
  userAccountId: string;
}

// Demo vendors, bootstrapped the same way a real magic-link first login does
// (../auth/userAccounts.ts, ../professionals/ensureProfessional.ts).
async function seedDemoProfessionals(): Promise<DemoProfessional[]> {
  const professionals: DemoProfessional[] = [];
  for (let i = 0; i < DEMO_PROFESSIONAL_COUNT; i += 1) {
    const displayName = faker.company.name();
    const email = `demo-vendor-${i + 1}@example.invalid`;
    // eslint-disable-next-line no-await-in-loop
    const account = await ensureUserAccountForEmail(db, email, displayName);
    // eslint-disable-next-line no-await-in-loop
    const professionalId = await ensureProfessionalForUserAccount(db, account.userAccountId, displayName);
    professionals.push({ professionalId, userAccountId: account.userAccountId });
  }
  return professionals;
}

interface DemoAssignment extends DemoProfessional {
  caseId: string;
}

async function seedDemoAssignments(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  caseIds: string[],
  professionals: DemoProfessional[],
): Promise<DemoAssignment[]> {
  const assignments: DemoAssignment[] = [];
  for (let i = 0; i < ASSIGNED_CASE_COUNT; i += 1) {
    const caseId = caseIds[i];
    const professional = professionals[i % professionals.length];
    if (!caseId || !professional) {
      throw new Error('Expected a demo case and professional for every assignment.');
    }
    // eslint-disable-next-line no-await-in-loop
    await db.insert(caseAssignment).values({
      caseId,
      professionalId: professional.professionalId,
      assignedAt: faker.date.recent({ days: 90 }),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    assignments.push({ caseId, ...professional });
  }
  return assignments;
}

// Logs time against every assignment and submits an invoice for most of them
// (one left un-invoiced, one left as a draft), so the invoice views aren't
// all empty on a fresh seed.
async function seedDemoTimeEntriesAndInvoices(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  assignments: DemoAssignment[],
): Promise<void> {
  for (const [index, assignment] of assignments.entries()) {
    const entryCount = faker.number.int({ min: 1, max: 3 });
    const timeEntryIds: string[] = [];
    for (let i = 0; i < entryCount; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await createTimeEntry(db, { professionalId: assignment.professionalId }, {
        caseId: assignment.caseId,
        activityOn: faker.date.recent({ days: 60 }).toISOString().slice(0, 10),
        durationHours: faker.number.float({ min: 0.5, max: 6, fractionDigits: 2 }),
        description: faker.lorem.sentence(),
      });
      timeEntryIds.push(result.timeEntryId);
    }

    // Leave the last un-invoiced; submit the second-to-last as a draft (direct
    // insert — createInvoice always submits) so status actually varies.
    if (index === assignments.length - 1) {
      continue;
    }
    if (index === assignments.length - 2) {
      // eslint-disable-next-line no-await-in-loop
      await db.insert(invoice).values({
        submittedByUserAccountId: assignment.userAccountId,
        professionalId: assignment.professionalId,
        statusId: fixtures.invoiceStatusDraftId,
        submittedTotal: '0.00',
        caseId: assignment.caseId,
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await createInvoice(db, { userAccountId: assignment.userAccountId, professionalId: assignment.professionalId }, {
      caseId: assignment.caseId,
      lines: timeEntryIds.map((sourceTimeEntryId, i) => ({
        amount: faker.number.float({ min: 25, max: 400, fractionDigits: 2 }),
        // Only the first line needs a context link to make the demo's point.
        sourceTimeEntryId: i === 0 ? sourceTimeEntryId : undefined,
      })),
    });
  }
}

async function main(): Promise<void> {
  const fixtures = await resetAndSeedBaselineFixtures(db);
  const caseIds = await seedDemoCases(fixtures);
  const professionals = await seedDemoProfessionals();
  const assignments = await seedDemoAssignments(fixtures, caseIds, professionals);
  await seedDemoTimeEntriesAndInvoices(fixtures, assignments);
  // eslint-disable-next-line no-console
  console.log(
    `Seed complete (${DEMO_CASE_COUNT} demo cases, ${assignments.length} external assignments with time/invoices).`,
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
