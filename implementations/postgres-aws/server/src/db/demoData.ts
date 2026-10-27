// The synthetic demo data behind `npm run seed` (./seed.ts) and the
// administrator's "Reset demo data" in Settings (../routes/settings.ts).
import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { db } from './client';
import { resetAndSeedBaselineFixtures } from './fixtures';
import { eq, inArray } from 'drizzle-orm';
import {
  person,
  personAffiliation,
  professional,
  userAccount,
  caseCategories,
  caseAssignment,
  caseIdentifier,
  invoice,
  invoiceLine,
  invoiceStatuses,
  preauthorization,
  preauthorizationDecision,
  preauthorizationOutcomes,
  preauthorizationStatuses,
  routeCheck,
} from './schema';
import { getReferenceId } from './referenceLookups';
import { reassignReviewer } from '../billing/reviewAssignment';
import { reviewInvoiceLine } from '../billing/reviewInvoiceLine';
import { finishReview, signOffInvoice } from '../billing/reviewRounds';
import { setReviewSettings } from '../billing/reviewSettings';
import { getDelegateAffiliationRoleId } from '../professionals/delegateRole';
import { createCase } from '../intake/createCase';
import { createTimeEntry } from '../portal/createTimeEntry';
import { createInvoice } from '../portal/createInvoice';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { assignStaffToCase } from '../cases/assignStaffToCase';
import { closeCase } from '../cases/closeCase';
import { addKindRate, createKind, listRates, setProfessionalKind } from '../billing/professionalRates';
import { addMileageRate } from '../billing/mileageRates';
import { addBillingCode, setBillingRule } from '../billing/billingRules';
import { pairKey } from '../billing/routeCheck';
import { getAdminAccountRoleId, getBillingReviewerRoleId, getSignOffApproverRoleId } from '../auth/staffAccountRole';
import { firstRow } from './rowHelpers';

// Dev/demo data only — deliberately not part of resetAndSeedBaselineFixtures,
// which __tests__/ also calls and relies on staying minimal (several tests
// assert zero pre-existing cases).
const DEMO_CASE_COUNT = 10;
const DEMO_PROFESSIONAL_COUNT = 4;
// Two become billing reviewers and one a sign-off approver (seedDemoReviewers).
const DEMO_STAFF_COUNT = 3;
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

// Demo vendors, bootstrapped the same way a real email-code first login does
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

  // Delegation is read through the account's person, which email-code
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
      attested: true,
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
    attested: true,
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

// Two reviewers, an approver and a sign-off default. Before any invoice is
// submitted, so each is routed to the sign-off default.
async function seedDemoReviewers(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  staffUserAccountIds: string[],
): Promise<void> {
  const [firstReviewer, secondReviewer, approver] = staffUserAccountIds;
  if (!firstReviewer || !secondReviewer || !approver) {
    throw new Error('Expected three demo staff accounts.');
  }
  await giveRole(firstReviewer, await getBillingReviewerRoleId(db));
  await giveRole(secondReviewer, await getBillingReviewerRoleId(db));
  await giveRole(approver, await getSignOffApproverRoleId(db));
  // No default reviewer, so new invoices wait to be taken.
  await setReviewSettings(db, fixtures.staffUserAccountId, { defaultSignOffUserAccountIds: [approver] });
}

// Review demo data: case and court numbers, pre-authorizations, an invoice
// billed above the configured rate, and invoices at each review state, one
// waiting long enough to be called out. Every value is synthetic.
async function seedDemoReview(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  caseIds: string[],
  assignments: DemoAssignment[],
  staffUserAccountIds: string[],
): Promise<void> {
  const [firstReviewer, secondReviewer, approver] = staffUserAccountIds as [string, string, string];

  for (const [index, caseId] of caseIds.entries()) {
    const number = String(index + 101).padStart(5, '0');
    // eslint-disable-next-line no-await-in-loop
    await db.insert(caseIdentifier).values([
      { caseId, identifierTypeId: fixtures.identifierTypeSampleId, issuer: 'Demo office', value: `DEMO-26-${number}`, isPrimary: true },
      { caseId, identifierTypeId: fixtures.identifierTypeSampleId, issuer: 'Demo court', value: `COURT-${number}` },
    ]);
  }

  const [approvedStatusId, approvedOutcomeId] = await Promise.all([
    getReferenceId(db, preauthorizationStatuses, 'approved'),
    getReferenceId(db, preauthorizationOutcomes, 'approved'),
  ]);
  const preauthorized = assignments.slice(0, 4);
  const rates = await listRates(db, preauthorized.map((assignment) => assignment.professionalId));
  for (const [index, assignment] of preauthorized.entries()) {
    // Pre-authorized at their configured rate; the investigator's demo
    // invoice below states more, for the rate check.
    const configured = rates.filter((rate) => rate.professionalId === assignment.professionalId).at(-1)?.hourlyRate ?? '125.00';
    const approvedHourlyRate = index === 2 ? '125.00' : configured;
    // eslint-disable-next-line no-await-in-loop
    const { preauthorizationId } = firstRow(
      await db
        .insert(preauthorization)
        .values({
          caseId: assignment.caseId,
          professionalId: assignment.professionalId,
          statusId: approvedStatusId,
          requestedAmount: '2500.00',
          requestedAt: new Date('2026-01-05T15:00:00Z'),
          authorizationNumber: `PA-${assignment.caseId.slice(0, 6).toUpperCase()}`,
        })
        .returning(),
    );
    // eslint-disable-next-line no-await-in-loop
    await db.insert(preauthorizationDecision).values({
      preauthorizationId,
      sequenceNumber: 1,
      outcomeId: approvedOutcomeId,
      approvedAmount: '2500.00',
      approvedHourlyRate,
      effectiveAt: new Date('2026-01-06T15:00:00Z'),
      decidedAt: new Date('2026-01-06T15:00:00Z'),
      decidedByUserAccountId: fixtures.staffUserAccountId,
    });
  }

  // An imported-style invoice stating a rate above the investigator's
  // configured rate, for the rate check and re-pricing.
  const investigator = assignments[2];
  if (!investigator) {
    throw new Error('Expected a demo investigator assignment.');
  }
  await createInvoice(db, { userAccountId: investigator.userAccountId, professionalId: investigator.professionalId }, {
    caseId: investigator.caseId,
    attested: true,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    lines: [
      { lineType: 'time', serviceDate: '2026-02-04', quantity: 0.5, unitRate: 175, description: 'Call with the client about the video evidence' },
      { lineType: 'time', serviceDate: '2026-02-08', quantity: 1.5, unitRate: 175, description: 'Researched the product and emailed the manufacturer' },
      { lineType: 'time', serviceDate: '2026-02-14', quantity: 1, unitRate: 175, description: 'Software update and file transfer to the client' },
      { lineType: 'time', serviceDate: '2026-02-14', quantity: 5.5, unitRate: 175, description: 'Script revision, filming and editing of a demonstration' },
    ],
  });

  const submitted = await db
    .select({ invoiceId: invoice.invoiceId })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoiceStatuses.code, 'submitted'))
    .orderBy(invoice.submittedAt);
  // Calendar days ago, by state; the unassigned one waits long enough to be called out.
  const daysAgo = [24, 9, 6, 16, 3, 1];
  for (const [index, row] of submitted.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(invoice)
      .set({ submittedAt: new Date(Date.now() - (daysAgo[index] ?? 1) * 24 * 60 * 60 * 1000) })
      .where(eq(invoice.invoiceId, row.invoiceId));
  }

  const lineIds = async (invoiceId: string) =>
    (await db.select({ id: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)).orderBy(invoiceLine.serviceDate)).map(
      (line) => line.id,
    );
  const approveAll = async (reviewer: string, invoiceId: string) => {
    for (const lineId of await lineIds(invoiceId)) {
      // eslint-disable-next-line no-await-in-loop
      await reviewInvoiceLine(db, reviewer, invoiceId, lineId, { outcome: 'approved' });
    }
  };
  const [signedOff, awaiting, inProgress, , mileage] = submitted.map((row) => row.invoiceId);
  // Signed off and ready to export.
  if (signedOff) {
    await approveAll(firstReviewer, signedOff);
    await finishReview(db, firstReviewer, signedOff);
    await signOffInvoice(db, approver, signedOff, { outcome: 'approved' });
  }
  // Finished and waiting for sign-off.
  if (awaiting) {
    await approveAll(secondReviewer, awaiting);
    await finishReview(db, secondReviewer, awaiting);
  }
  // Part way through, with one line cut.
  if (inProgress) {
    const [first] = await lineIds(inProgress);
    if (first) {
      await reviewInvoiceLine(db, firstReviewer, inProgress, first, {
        outcome: 'rejected',
        reasonCode: 'duplicate',
        note: 'Same call as the entry the day before.',
      });
    }
  }
  // Given to a reviewer but not started.
  if (mileage) {
    await reassignReviewer(db, firstReviewer, mileage, { userAccountId: firstReviewer });
  }
}

async function giveRole(userAccountId: string, systemRoleId: string): Promise<void> {
  await db.update(userAccount).set({ systemRoleId }).where(eq(userAccount.userAccountId, userAccountId));
}

export interface DemoDataSummary {
  caseCount: number;
  assignmentCount: number;
  staffCount: number;
}

// Destructive: deletes all application data, including accounts, then
// recreates the synthetic demo data.
export async function resetToDemoData(): Promise<DemoDataSummary> {
  const fixtures = await resetAndSeedBaselineFixtures(db);
  const caseIds = await seedDemoCases(fixtures);
  const professionals = await seedDemoProfessionals();
  await seedDemoDelegate(fixtures, professionals);
  await seedDemoRates(fixtures, professionals);
  await seedDemoBillingCodes();
  const staffUserAccountIds = await seedDemoStaff(fixtures);
  await seedDemoReviewers(fixtures, staffUserAccountIds);
  const assignments = await seedDemoAssignments(fixtures, caseIds, professionals);
  await seedDemoTimeEntriesAndInvoices(fixtures, assignments);
  await seedDemoMileage(fixtures, assignments);
  await seedClosedCase(fixtures, caseIds);
  await seedStaffAssignment(fixtures, caseIds, staffUserAccountIds);
  await seedDemoReview(fixtures, caseIds, assignments, staffUserAccountIds);
  return { caseCount: DEMO_CASE_COUNT, assignmentCount: assignments.length, staffCount: staffUserAccountIds.length };
}
