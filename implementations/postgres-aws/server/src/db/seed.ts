import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { db, pool } from './client';
import { resetAndSeedBaselineFixtures } from './fixtures';
import { eq, inArray } from 'drizzle-orm';
import { person, personAffiliation, professional, userAccount, caseCategories, caseAssignment, routeCheck } from './schema';
import { getDelegateAffiliationRoleId } from '../professionals/delegateRole';
import { createCase } from '../intake/createCase';
import { createTimeEntry } from '../portal/createTimeEntry';
import { createInvoice } from '../portal/createInvoice';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { assignStaffToCase } from '../cases/assignStaffToCase';
import { closeCase } from '../cases/closeCase';
import { addKindRate, createKind, setProfessionalKind } from '../billing/professionalRates';
import { addMileageRate } from '../billing/mileageRates';
import { addBillingCode, setBillingRule } from '../billing/billingRules';
import { pairKey } from '../billing/routeCheck';
import { getAdminAccountRoleId } from '../auth/staffAccountRole';
import { firstRow } from './rowHelpers';

// Dev/demo data only — deliberately not part of resetAndSeedBaselineFixtures,
// which __tests__/ also calls and relies on staying minimal (several tests
// assert zero pre-existing cases).
const DEMO_CASE_COUNT = 10;
const DEMO_PROFESSIONAL_COUNT = 4;
const DEMO_STAFF_COUNT = 2;
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
    const displayName = `${faker.person.firstName()} ${faker.person.lastName()}`;
    const email = `demo-vendor-${i + 1}@example.invalid`;
    // eslint-disable-next-line no-await-in-loop
    const account = await ensureUserAccountForEmail(db, email, displayName);
    // eslint-disable-next-line no-await-in-loop
    const professionalId = await ensureProfessionalForUserAccount(db, account.userAccountId, displayName);
    professionals.push({ professionalId, userAccountId: account.userAccountId });
  }
  return professionals;
}

// Every demo vendor is in one office, and the first (the demo partner
// sign-in) is its delegate, so one sign-in bills for itself and several
// colleagues.
async function seedDemoDelegate(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  professionals: DemoProfessional[],
): Promise<void> {
  const startedAt = new Date('2026-01-01T00:00:00Z');
  const members = await db
    .select({ personId: professional.personId })
    .from(professional)
    .where(inArray(professional.professionalId, professionals.map((p) => p.professionalId)));
  await db.insert(personAffiliation).values(
    members.map(({ personId }) => ({
      personId,
      organizationId: fixtures.organizationId,
      officeId: fixtures.officeId,
      startedAt,
    })),
  );

  // Delegation is read through the account's person, which magic-link
  // sign-up doesn't link.
  const [delegate] = professionals;
  if (!delegate) {
    throw new Error('Expected a demo vendor to act as delegate.');
  }
  const { personId } = firstRow(
    await db
      .select({ personId: professional.personId })
      .from(professional)
      .where(eq(professional.professionalId, delegate.professionalId)),
  );
  await db.update(userAccount).set({ personId }).where(eq(userAccount.userAccountId, delegate.userAccountId));
  await db.insert(personAffiliation).values({
    personId,
    organizationId: fixtures.organizationId,
    officeId: fixtures.officeId,
    affiliationRoleId: await getDelegateAffiliationRoleId(db),
    startedAt,
  });
}

// Synthetic kinds and hourly rates, as an administrator would set them, so
// time can be invoiced. The demo staff sign-in is that administrator.
const DEMO_KINDS = [
  { displayName: 'Attorney', hourlyRate: 125 },
  { displayName: 'Investigator', hourlyRate: 75 },
  { displayName: 'Expert', hourlyRate: 200 },
];
const DEMO_VENDOR_KINDS = ['Attorney', 'Attorney', 'Investigator', 'Expert'];

// Synthetic codes for the billing codes rule; every rule starts off.
async function seedDemoBillingCodes(): Promise<void> {
  for (const [code, displayName] of [
    ['T100', 'Research and analysis'],
    ['T200', 'Client communication'],
    ['T300', 'Court appearance'],
    ['T400', 'Investigation'],
    ['T500', 'Travel'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await addBillingCode(db, { code, displayName });
  }
}

async function seedDemoRates(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  professionals: DemoProfessional[],
): Promise<void> {
  await db
    .update(userAccount)
    .set({ systemRoleId: await getAdminAccountRoleId(db) })
    .where(eq(userAccount.userAccountId, fixtures.staffUserAccountId));
  const kindIds = new Map<string, string>();
  for (const { displayName, hourlyRate } of DEMO_KINDS) {
    // eslint-disable-next-line no-await-in-loop
    const { professionalKindId } = await createKind(db, { displayName });
    // eslint-disable-next-line no-await-in-loop
    await addKindRate(db, fixtures.staffUserAccountId, professionalKindId, { hourlyRate, effectiveFrom: '2025-01-01' });
    kindIds.set(displayName, professionalKindId);
  }
  // Synthetic, not any agency's rate.
  await addMileageRate(db, fixtures.staffUserAccountId, { ratePerMile: 0.6, effectiveFrom: '2025-01-01' });
  for (const [index, { professionalId }] of professionals.entries()) {
    const kind = DEMO_VENDOR_KINDS[index % DEMO_VENDOR_KINDS.length]!;
    // eslint-disable-next-line no-await-in-loop
    await setProfessionalKind(db, professionalId, { professionalKindId: kindIds.get(kind) });
  }
}

// Other full (SSO) users to search for and assign in the "Assign staff"
// form (client/src/components/AssignStaffForm.tsx) — distinct from
// fixtures.staffUserAccountId, the one synthetic account every demo case
// is already created by, so there's someone else to find and assign.
async function seedDemoStaff(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
): Promise<string[]> {
  const userAccountIds: string[] = [];
  for (let i = 0; i < DEMO_STAFF_COUNT; i += 1) {
    const displayName = faker.person.fullName();
    const email = `demo-staff-${i + 1}@example.invalid`;
    // eslint-disable-next-line no-await-in-loop
    const account = await ensureUserAccountForEmail(db, email, displayName, fixtures.intakeStaffRoleId);
    userAccountIds.push(account.userAccountId);
  }
  return userAccountIds;
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
      const result = await createTimeEntry(db, { userAccountId: assignment.userAccountId, professionalId: assignment.professionalId }, {
        caseId: assignment.caseId,
        activityOn: faker.date.recent({ days: 60 }).toISOString().slice(0, 10),
        durationHours: faker.number.float({ min: 0.5, max: 6, fractionDigits: 2 }),
        description: faker.lorem.sentence(),
      });
      timeEntryIds.push(result.timeEntryId);
    }

    // Leave the last un-invoiced and keep the second-to-last as a draft, so
    // status actually varies.
    if (index === assignments.length - 1) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await createInvoice(db, { userAccountId: assignment.userAccountId, professionalId: assignment.professionalId }, {
      caseId: assignment.caseId,
      submit: index !== assignments.length - 2,
      // Priced from the demo rates (seedDemoRates).
      lines: timeEntryIds.map((sourceTimeEntryId) => ({ sourceTimeEntryId })),
    });
  }
}

// Public landmarks in Washington, D.C., unrelated to any agency, so map links
// and real route lookups work. The office is the Library of Congress.
const DEMO_OFFICE = '10 First St SE, Washington, DC 20540';
const LINCOLN_MEMORIAL = '2 Lincoln Memorial Cir NW, Washington, DC 20002';
const NATIONAL_CATHEDRAL = '3101 Wisconsin Ave NW, Washington, DC 20016';
const NATIONAL_ZOO = '3001 Connecticut Ave NW, Washington, DC 20008';
const NATIONALS_PARK = '1500 S Capitol St SE, Washington, DC 20003';
// Approximate one-way driving miles, used only without a routing service.
const DEMO_TRIP_MILES: Array<[string, string]> = [
  [LINCOLN_MEMORIAL, '2.8'],
  [NATIONAL_CATHEDRAL, '5.6'],
  [NATIONAL_ZOO, '4.3'],
];

// Turns the mileage distance rule on (warn) and gives the demo partner a
// submitted invoice with trips, one over-claimed, and a draft trip with no
// distance yet, to submit and check with the map link. With a routing
// service configured, the submitted trips are looked up for real.
async function seedDemoMileage(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  assignments: DemoAssignment[],
): Promise<void> {
  await setBillingRule(db, fixtures.staffUserAccountId, 'mileage_distance', {
    enforcement: 'warn',
    parameters: { tolerancePercent: 10 },
  });
  if (process.env.ROUTE_CHECK_PROVIDER !== 'aws') {
    await db.insert(routeCheck).values(
      DEMO_TRIP_MILES.map(([destination, miles]) => ({
        pairKey: pairKey(DEMO_OFFICE, destination)!,
        outcome: 'found',
        distanceMiles: miles,
        apiCalls: 0,
        checkedAt: new Date(),
      })),
    );
  }
  const own = assignments.filter((assignment) => assignment.professionalId === assignments[0]?.professionalId);
  const [first, second] = own;
  if (!first || !second) {
    throw new Error('Expected the demo partner to have two assigned cases.');
  }
  const actor = { userAccountId: first.userAccountId, professionalId: first.professionalId };
  const trip = (serviceDate: string, description: string, to: string, miles: number, roundTrip: boolean) => ({
    lineType: 'mileage' as const,
    serviceDate,
    description,
    quantity: miles,
    tripOrigin: DEMO_OFFICE,
    tripDestination: to,
    roundTrip,
  });
  await createInvoice(db, actor, {
    caseId: first.caseId,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    lines: [
      trip('2026-02-03', 'Meeting near the Lincoln Memorial', LINCOLN_MEMORIAL, 4.5, true),
      { lineType: 'expense', serviceDate: '2026-02-03', description: 'Parking', amount: 8 },
      // Far over the roughly 11 mi round trip, so it's flagged.
      trip('2026-02-10', 'Client visit near the National Cathedral', NATIONAL_CATHEDRAL, 30, true),
      trip('2026-02-17', 'Witness interview near the National Zoo', NATIONAL_ZOO, 4, false),
    ],
  });
  await createInvoice(db, actor, {
    caseId: second.caseId,
    submit: false,
    lines: [trip('2026-02-24', 'Records pickup near Nationals Park', NATIONALS_PARK, 2.5, true)],
  });
}

// Closes one never-assigned case via the same path as the "Close case"
// UI, so the demo data covers a case that has left the overview board
// entirely (../cases/caseStage.ts: a closed case has no stage).
async function seedClosedCase(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  caseIds: string[],
): Promise<void> {
  const caseId = caseIds[caseIds.length - 1];
  if (!caseId) {
    throw new Error('Expected at least one demo case to close.');
  }
  await closeCase(db, fixtures.staffUserAccountId, caseId, { reasonDetail: 'Demo closure' });
}

// Assigns one of the still-unassigned demo cases (index ASSIGNED_CASE_COUNT,
// just past seedDemoAssignments' range) to a demo staff member via the
// same path the "Assign staff" UI uses, so the represented stage has an
// example reached through internal assignment, not only external.
async function seedStaffAssignment(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  caseIds: string[],
  staffUserAccountIds: string[],
): Promise<void> {
  const caseId = caseIds[ASSIGNED_CASE_COUNT];
  const staffUserAccountId = staffUserAccountIds[0];
  if (!caseId || !staffUserAccountId) {
    throw new Error('Expected an unassigned demo case and a demo staff account.');
  }
  await assignStaffToCase(db, fixtures.staffUserAccountId, caseId, { userAccountId: staffUserAccountId });
}

async function main(): Promise<void> {
  const fixtures = await resetAndSeedBaselineFixtures(db);
  const caseIds = await seedDemoCases(fixtures);
  const professionals = await seedDemoProfessionals();
  await seedDemoDelegate(fixtures, professionals);
  await seedDemoRates(fixtures, professionals);
  await seedDemoBillingCodes();
  const staffUserAccountIds = await seedDemoStaff(fixtures);
  const assignments = await seedDemoAssignments(fixtures, caseIds, professionals);
  await seedDemoTimeEntriesAndInvoices(fixtures, assignments);
  await seedDemoMileage(fixtures, assignments);
  await seedClosedCase(fixtures, caseIds);
  await seedStaffAssignment(fixtures, caseIds, staffUserAccountIds);
  // eslint-disable-next-line no-console
  console.log(
    `Seed complete (${DEMO_CASE_COUNT} demo cases, ${assignments.length} external assignments with time/invoices, ` +
      `${staffUserAccountIds.length} demo staff, 1 closed).`,
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
