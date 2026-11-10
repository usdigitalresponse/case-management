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
import { reassignReviewer, setSignOffApprovers } from '../billing/reviewAssignment';
import { answerQuestionAsSubmitter, askQuestion } from '../billing/reviewQuestions';
import { reviewInvoiceLine } from '../billing/reviewInvoiceLine';
import { finishReview, signOffInvoice } from '../billing/reviewRounds';
import { setReviewSettings } from '../billing/reviewSettings';
import { getDelegateAffiliationRoleId } from '../professionals/delegateRole';
import { createCase } from '../intake/createCase';
import { applyLineRate } from '../billing/caseRates';
import { createTimeEntry } from '../portal/createTimeEntry';
import { createInvoice } from '../portal/createInvoice';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { assignStaffToCase } from '../cases/assignStaffToCase';
import { closeCase } from '../cases/closeCase';
import { addKindRate, addOwnRates, createKind, listRates, setProfessionalKind } from '../billing/professionalRates';
import { addMileageRate } from '../billing/mileageRates';
import { addTimeCategoryRate } from '../billing/timeCategoryRates';
import { addBillingCode, setBillingRule } from '../billing/billingRules';
import { pairKey } from '../billing/routeCheck';
import { getAdminAccountRoleId, getStaffAccountRoleId } from '../auth/staffAccountRole';
import { firstRow } from './rowHelpers';
import { seedDemoUploads } from './demoUploads';

// Dev/demo data only — deliberately not part of resetAndSeedBaselineFixtures,
// which __tests__/ also calls and relies on staying minimal (several tests
// assert zero pre-existing cases).
const DEMO_CASE_COUNT = 10;
const DEMO_PROFESSIONAL_COUNT = 4;
// All three are staff; the third is the Director, the only one who signs off (seedDemoReviewers).
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
  await addMileageRate(db, fixtures.staffUserAccountId, { ratePerMile: 0.76, effectiveFrom: '2025-01-01' });
  await addTimeCategoryRate(db, fixtures.staffUserAccountId, { category: 'travel', basis: 'percent_of_hourly_rate', percent: 50, effectiveFrom: '2025-01-01' });
  for (const [index, { professionalId }] of professionals.entries()) {
    const kind = DEMO_VENDOR_KINDS[index % DEMO_VENDOR_KINDS.length]!;
    // eslint-disable-next-line no-await-in-loop
    await setProfessionalKind(db, professionalId, { professionalKindId: kindIds.get(kind) });
    // 555-01xx numbers are reserved for fiction.
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(professional)
      .set({ paidThrough: DEMO_PAID_THROUGH[index], phone: `(555) 555-01${String(index + 10)}` })
      .where(eq(professional.professionalId, professionalId));
    const own = DEMO_OWN_RATES[index];
    if (own) {
      // eslint-disable-next-line no-await-in-loop
      await addOwnRates(db, fixtures.staffUserAccountId, professionalId, { ...own, effectiveFrom: '2025-01-01' });
    }
  }
}

// By demo vendor (DEMO_VENDOR_KINDS); the investigator and expert have their own rates.
const DEMO_PAID_THROUGH = ['Synthetic Law Office', 'Example Defense LLP', 'Sample Investigations LLC', 'Demo Forensic Consulting'];
const DEMO_OWN_RATES: Array<{ hourlyRate: number; ratePerMile?: number } | undefined> = [
  undefined,
  undefined,
  { hourlyRate: 95, ratePerMile: 0.7 },
  { hourlyRate: 150 },
];

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

// As senders typed them: some shared, one without dashes, and the review
// invoice below a close match, so the queue's match notes show.
const TYPED_CASE_NUMBERS = ['26-CR-00211', '26-CR-00214', '26CR230', '26-CR-00211', '26-CR-00245'];
// Their counties, settings included.
const DEMO_COUNTIES = ['County A', 'County B', 'Post-conviction', 'County A', 'Prison'];

// By demo vendor kind (DEMO_VENDOR_KINDS).
const DEMO_TIME_DESCRIPTIONS: Record<string, string[]> = {
  Attorney: [
    'Reviewed discovery from the prosecution',
    'Met the client to go over the case',
    'Drafted a motion to continue',
    'Prepared for the pretrial hearing',
    'Attended the status conference',
    'Called the client about the plea offer',
  ],
  Investigator: [
    'Interviewed a witness',
    'Photographed the scene',
    'Requested records from the hospital',
    'Reviewed the surveillance video',
    'Wrote up the witness interview',
    'Tried to locate a witness at their last known address',
  ],
  Expert: [
    'Reviewed the lab report',
    'Examined the evidence',
    'Drafted the expert report',
    'Called counsel about the findings',
    'Prepared to testify',
  ],
};

// Logs time on every assignment's case, and an invoice filed by person for
// most (one left un-invoiced, one a draft), so status varies.
async function seedDemoTimeEntriesAndInvoices(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  assignments: DemoAssignment[],
): Promise<void> {
  for (const [index, assignment] of assignments.entries()) {
    const actor = { userAccountId: assignment.userAccountId, professionalId: assignment.professionalId };
    const descriptions = DEMO_TIME_DESCRIPTIONS[DEMO_VENDOR_KINDS[index % DEMO_VENDOR_KINDS.length]!]!;
    const entries = Array.from({ length: faker.number.int({ min: 1, max: 3 }) }, () => ({
      activityOn: faker.date.recent({ days: 60 }).toISOString().slice(0, 10),
      durationHours: faker.number.float({ min: 0.5, max: 6, fractionDigits: 2 }),
      description: faker.helpers.arrayElement(descriptions),
    }));
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      await createTimeEntry(db, actor, { caseId: assignment.caseId, ...entry });
    }

    // Leave the last un-invoiced and keep the second-to-last as a draft, so
    // status actually varies.
    if (index === assignments.length - 1) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await createInvoice(db, actor, {
      caseId: null,
      caseNumber: TYPED_CASE_NUMBERS[index],
      countyName: DEMO_COUNTIES[index],
      submit: index !== assignments.length - 2,
      attested: true,
      // Priced from the demo rates (seedDemoRates).
      lines: entries.map((entry) => ({
        lineType: 'time' as const,
        serviceDate: entry.activityOn,
        quantity: entry.durationHours,
        description: entry.description,
      })),
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
    caseId: null,
    caseNumber: '26-CR-00211',
    countyName: 'County A',
    attested: true,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    lines: [
      // One trip: its travel time, miles and parking are separate items.
      { ...trip('2026-02-03', 'Meeting near the Lincoln Memorial', LINCOLN_MEMORIAL, 4.5, true), tripKey: 'lincoln' },
      { ...trip('2026-02-03', 'Travel to the meeting and back', LINCOLN_MEMORIAL, 0, true), lineType: 'time', quantity: 0.5, tripKey: 'lincoln' },
      { ...trip('2026-02-03', 'Parking', LINCOLN_MEMORIAL, 0, true), lineType: 'expense', quantity: undefined, amount: 8, tripKey: 'lincoln' },
      // Far over the roughly 11 mi round trip, so it's flagged.
      trip('2026-02-10', 'Client visit near the National Cathedral', NATIONAL_CATHEDRAL, 30, true),
      trip('2026-02-17', 'Witness interview near the National Zoo', NATIONAL_ZOO, 4, false),
    ],
  });
  await createInvoice(db, actor, {
    caseId: null,
    caseNumber: '26-CR-00252',
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

// Three staff members; the third, the agency Director, is the only one who
// signs off. Before any invoice is submitted, so each is routed to them.
async function seedDemoReviewers(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  staffUserAccountIds: string[],
): Promise<void> {
  const [firstReviewer, secondReviewer, director] = staffUserAccountIds;
  if (!firstReviewer || !secondReviewer || !director) {
    throw new Error('Expected three demo staff accounts.');
  }
  const staffRoleId = await getStaffAccountRoleId(db);
  for (const userAccountId of [firstReviewer, secondReviewer, director]) {
    // eslint-disable-next-line no-await-in-loop
    await giveRole(userAccountId, staffRoleId);
  }
  // No default reviewer, so new invoices wait to be taken.
  await setReviewSettings(db, fixtures.staffUserAccountId, {
    signOffBy: 'approvers',
    signOffApproverUserAccountIds: [director],
    defaultSignOffUserAccountIds: [director],
  });
}

// Review demo data: case and court numbers and pre-authorizations on the
// cases (used only by the case pages; invoices filed by person are checked
// against configured rates), an invoice billed above the configured rate,
// and invoices at each review state, one waiting long enough to be called
// out. Every value is synthetic.
async function seedDemoReview(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  caseIds: string[],
  assignments: DemoAssignment[],
  staffUserAccountIds: string[],
): Promise<void> {
  const [firstReviewer, secondReviewer, director] = staffUserAccountIds as [string, string, string];

  for (const [index, caseId] of caseIds.entries()) {
    const number = String(index + 101).padStart(5, '0');
    // eslint-disable-next-line no-await-in-loop
    await db.insert(caseIdentifier).values([
      { caseId, identifierTypeId: fixtures.identifierTypeSampleId, issuer: 'Demo office', value: `DEMO-26-${number}`, isPrimary: true },
      { caseId, identifierTypeId: fixtures.identifierTypeSampleId, issuer: 'Demo court', value: `COURT-${number}` },
    ]);
  }

  // The expert's case also has the number their sender types, so the
  // invoice they filed by person can be matched to it while it is reviewed.
  const expertCase = assignments[3]?.caseId;
  if (expertCase) {
    await db.insert(caseIdentifier).values({
      caseId: expertCase,
      identifierTypeId: fixtures.identifierTypeSampleId,
      issuer: 'Demo court',
      value: '26-CR-00245',
    });
  }

  const [approvedStatusId, approvedOutcomeId] = await Promise.all([
    getReferenceId(db, preauthorizationStatuses, 'approved'),
    getReferenceId(db, preauthorizationOutcomes, 'approved'),
  ]);
  const preauthorized = assignments.slice(0, 4);
  const rates = await listRates(db, preauthorized.map((assignment) => assignment.professionalId));
  for (const [index, assignment] of preauthorized.entries()) {
    // Pre-authorized at their configured rate.
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
    caseId: null,
    // A close match for 26-CR-00211, as a sender might type it.
    caseNumber: '26-CR-0211',
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
  // Signed off by the Director and ready to export.
  if (signedOff) {
    await approveAll(firstReviewer, signedOff);
    await finishReview(db, firstReviewer, signedOff);
    await signOffInvoice(db, director, signedOff, { outcome: 'approved', comment: 'Checked against the pre-authorization.' });
  }
  // Waiting for the Director; both reviewers decided lines, so each line shows who.
  if (awaiting) {
    await approveAll(secondReviewer, awaiting);
    const [first] = await lineIds(awaiting);
    if (first) {
      await reviewInvoiceLine(db, firstReviewer, awaiting, first, { outcome: 'approved' });
    }
    await finishReview(db, secondReviewer, awaiting);
  }
  // Part way through by the demo sign-in, with one line cut and a question
  // waiting for the sender's answer.
  if (inProgress) {
    const lines = await lineIds(inProgress);
    const [first] = lines;
    const last = lines.at(-1);
    if (first && last) {
      await reviewInvoiceLine(db, fixtures.staffUserAccountId, inProgress, first, {
        outcome: 'rejected',
        reasonCode: 'duplicate',
        note: 'Already billed on an earlier invoice.',
      });
      await askQuestion(db, fixtures.staffUserAccountId, inProgress, {
        invoiceLineId: last,
        question: 'Could you say a little more about what this time covered?',
      });
    }
  }
  // Given to the first reviewer, who gets the sender's new invoices too; the
  // second has decided a line on it, as anyone on staff may.
  if (mileage) {
    await reassignReviewer(db, firstReviewer, mileage, { userAccountId: firstReviewer, forPerson: true });
    const [first] = await lineIds(mileage);
    if (first) {
      await reviewInvoiceLine(db, secondReviewer, mileage, first, { outcome: 'approved' });
    }
  }

  await seedDemoSignInReview(fixtures, assignments, secondReviewer, director, lineIds);
}

// One invoice just submitted and given to the demo sign-in to review, billed
// above the configured rate; two on a case with a case rate; one another
// reviewer finished, with an answered question and a changed rate, for the
// Director to sign off; and one the Director rejected whole.
async function seedDemoSignInReview(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  assignments: DemoAssignment[],
  reviewer: string,
  director: string,
  lineIds: (invoiceId: string) => Promise<string[]>,
): Promise<void> {
  const signIn = fixtures.staffUserAccountId;
  const [, attorney, , expert] = assignments;
  if (!attorney || !expert) {
    throw new Error('Expected demo attorney and expert assignments.');
  }

  // The expert's configured rate is $150.
  const toReview = await createInvoice(db, { userAccountId: expert.userAccountId, professionalId: expert.professionalId }, {
    caseId: null,
    caseNumber: '26-CR-00245',
    attested: true,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    lines: [
      { lineType: 'time', serviceDate: '2026-03-03', quantity: 2, unitRate: 180, description: 'Reviewed the lab report and photographs' },
      { lineType: 'time', serviceDate: '2026-03-10', quantity: 3.5, unitRate: 180, description: 'Drafted the expert report' },
      { lineType: 'time', serviceDate: '2026-03-12', quantity: 1, unitRate: 180, description: 'Call with counsel about the draft report' },
    ],
  });
  await reassignReviewer(db, signIn, toReview.invoiceId, { userAccountId: signIn });

  // On the expert's case: one sent first and given to the demo sign-in, then
  // one on which a reviewer set the case's rate, waiting for the Director.
  // The first is flagged, since its default changed after it was sent.
  const expertActor = { userAccountId: expert.userAccountId, professionalId: expert.professionalId };
  const sentEarlier = await createInvoice(db, expertActor, {
    caseId: expert.caseId,
    attested: true,
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    lines: [
      { lineType: 'time', serviceDate: '2026-04-06', quantity: 2, unitRate: 170, description: 'Examined the evidence' },
      { lineType: 'time', serviceDate: '2026-04-13', quantity: 1.5, unitRate: 170, description: 'Called counsel about the findings' },
      { lineType: 'time', serviceDate: '2026-04-20', quantity: 4, unitRate: 170, description: 'Prepared to testify' },
    ],
  });
  await reassignReviewer(db, signIn, sentEarlier.invoiceId, { userAccountId: signIn });
  const caseRateSet = await createInvoice(db, expertActor, {
    caseId: expert.caseId,
    attested: true,
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    lines: [
      { lineType: 'time', serviceDate: '2026-05-04', quantity: 3, unitRate: 170, description: 'Drafted the expert report' },
      { lineType: 'time', serviceDate: '2026-05-11', quantity: 2.5, unitRate: 170, description: 'Testified at trial' },
    ],
  });
  const [report] = await lineIds(caseRateSet.invoiceId);
  if (!report) {
    throw new Error('Expected lines on the case rate demo invoice.');
  }
  const { caseRateId } = await applyLineRate(db, reviewer, caseRateSet.invoiceId, report, {
    rate: 165,
    scope: 'case',
    target: 'person',
    effectiveFrom: '2026-04-01',
    reasonCode: 'case_rate_agreed',
    note: 'Agreed with counsel when the expert was retained.',
    basedOnCaseRateId: null,
  });
  if (!caseRateId) {
    throw new Error('Expected the demo case rate to be set.');
  }
  await setSignOffApprovers(db, reviewer, caseRateSet.invoiceId, { userAccountIds: [director] });
  await finishReview(db, reviewer, caseRateSet.invoiceId);

  const attorneyActor = { userAccountId: attorney.userAccountId, professionalId: attorney.professionalId };
  const toSignOff = await createInvoice(db, attorneyActor, {
    caseId: null,
    caseNumber: '26-CR-00214',
    attested: true,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    lines: [
      { lineType: 'time', serviceDate: '2026-03-02', quantity: 1.5, description: 'Met the client to go over the plea offer' },
      { lineType: 'time', serviceDate: '2026-03-09', quantity: 2.25, description: 'Prepared the motion to suppress' },
      { lineType: 'time', serviceDate: '2026-03-16', quantity: 3, description: 'Attended the motion hearing' },
    ],
  });
  await db
    .update(invoice)
    .set({ submittedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) })
    .where(eq(invoice.invoiceId, toSignOff.invoiceId));
  const [meeting, motion, hearing] = await lineIds(toSignOff.invoiceId);
  if (!meeting || !motion || !hearing) {
    throw new Error('Expected three lines on the sign-off demo invoice.');
  }
  await reviewInvoiceLine(db, reviewer, toSignOff.invoiceId, meeting, { outcome: 'approved' });
  const { invoiceReviewQuestionId } = await askQuestion(db, reviewer, toSignOff.invoiceId, {
    invoiceLineId: hearing,
    question: 'Was the hearing continued, or did it go ahead?',
  });
  await answerQuestionAsSubmitter(db, attorneyActor, toSignOff.invoiceId, invoiceReviewQuestionId, {
    answer: 'It went ahead; the motion was argued and taken under advisement.',
  });
  await reviewInvoiceLine(db, reviewer, toSignOff.invoiceId, motion, { outcome: 'approved', approvedRate: 110 });
  await reviewInvoiceLine(db, reviewer, toSignOff.invoiceId, hearing, { outcome: 'approved' });
  await setSignOffApprovers(db, reviewer, toSignOff.invoiceId, { userAccountIds: [director] });
  await finishReview(db, reviewer, toSignOff.invoiceId);

  // Billed under another case's number; the Director rejected it whole.
  const rejected = await createInvoice(db, attorneyActor, {
    caseId: null,
    caseNumber: '26-CR-00214',
    attested: true,
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    lines: [
      { lineType: 'time', serviceDate: '2026-02-05', quantity: 1, description: 'Reviewed discovery' },
      { lineType: 'time', serviceDate: '2026-02-19', quantity: 0.75, description: 'Call with the prosecutor' },
    ],
  });
  for (const lineId of await lineIds(rejected.invoiceId)) {
    // eslint-disable-next-line no-await-in-loop
    await reviewInvoiceLine(db, reviewer, rejected.invoiceId, lineId, { outcome: 'approved' });
  }
  await finishReview(db, reviewer, rejected.invoiceId);
  await signOffInvoice(db, director, rejected.invoiceId, {
    outcome: 'rejected',
    comment: 'This work was for a different case. Ask the attorney to send it again under the right case number.',
  });
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
  const [partner, colleague] = professionals;
  if (!partner || !colleague) {
    throw new Error('Expected two demo vendors for the uploads.');
  }
  await seedDemoUploads({ partner, colleague, staffUserAccountId: fixtures.staffUserAccountId });
  return { caseCount: DEMO_CASE_COUNT, assignmentCount: assignments.length, staffCount: staffUserAccountIds.length };
}
