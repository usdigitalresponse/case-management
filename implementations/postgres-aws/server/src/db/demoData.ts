// The synthetic demo data behind `npm run seed` (./seed.ts) and the
// administrator's "Reset demo data" in Settings (../routes/settings.ts).
import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { db } from './client';
import { resetAndSeedBaselineFixtures } from './fixtures';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  person,
  personAffiliation,
  professional,
  userAccount,
  caseCategories,
  caseAssignment,
  caseLifecycleEvent,
  caseTable,
  county,
  caseIdentifier,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceAttestation,
  invoiceEvent,
  invoiceLine,
  invoiceReviewAssignment,
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
import { setDraftCaseNumber, setDraftCounty } from '../billing/invoiceLifecycle/drafts';
import { submitInvoice } from '../billing/invoiceLifecycle/submit';
import { applyCaseChoiceAfterSend, setDraftCaseChoice } from '../billing/caseChoice';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { assignStaffToCase } from '../cases/assignStaffToCase';
import { closeCase } from '../cases/closeCase';
import { addKindRate, addOwnRates, createKind, listRates, setProfessionalKind } from '../billing/professionalRates';
import { addThreshold, getThresholdSettings, setKindThresholdApplies } from '../billing/preauthorizationThresholds';
import { askRequestQuestion, decidePreauthorizationRequest } from '../billing/preauthorizationRequests/decide';
import { createPreauthorizationRequest } from '../billing/preauthorizationRequests/submit';
import { resolvePortalActor } from '../portal/portalActor';
import { addMileageRate } from '../billing/mileageRates';
import { addTimeCategoryRate } from '../billing/timeCategoryRates';
import { addBillingCode, setBillingRule } from '../billing/billingRules';
import { pairKey } from '../billing/routeCheck';
import { getAdminAccountRoleId, getStaffAccountRoleId } from '../auth/staffAccountRole';
import { firstRow } from './rowHelpers';
import { seedDemoUploads } from './demoUploads';
import { addProfessional } from '../professionals/addProfessional';

// Not in resetAndSeedBaselineFixtures, which tests rely on staying minimal.
const DEMO_CASE_COUNT = 10;
const DEMO_PROFESSIONAL_COUNT = 4;
// All three are staff; the third is the Director, the only one who signs off (seedDemoReviewers).
const DEMO_STAFF_COUNT = 3;
// How many demo cases get an external-submitter assignment with time and invoices.
const ASSIGNED_CASE_COUNT = 6;

async function seedDemoCases(fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>): Promise<string[]> {
  const categories = await db.select().from(caseCategories);
  const caseIds: string[] = [];
  // Spread across counties, so By county and the case step's county matching show.
  const counties = await db
    .select({ countyId: county.countyId })
    .from(county)
    .where(and(eq(county.active, true), eq(county.isCounty, true)))
    .orderBy(asc(county.displayName))
    .limit(3);

  for (let i = 0; i < DEMO_CASE_COUNT; i += 1) {
    const givenName = faker.person.firstName();
    const familyName = faker.person.lastName();
    const demoPerson = firstRow(
      // eslint-disable-next-line no-await-in-loop
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
        countyId: counties[i % counties.length]?.countyId ?? fixtures.countyId,
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
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(person)
      .set({ externalSignInEnabled: true })
      .where(sql`${person.personId} = (select person_id from professional where professional_id = ${professionalId})`);
    professionals.push({ professionalId, userAccountId: account.userAccountId });
  }
  return professionals;
}

// Every demo vendor is in one office, whose delegate is the first (the external demo sign-in), billing for all.
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

// Staff besides fixtures.staffUserAccountId, who creates every demo case, to find and assign.
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
async function seedDemoTimeEntriesAndInvoices(assignments: DemoAssignment[]): Promise<void> {
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

// Cases arrive with their first invoice (design I): the two cases after the
// staff-assigned one each get a sender and a sent invoice no reviewer has
// taken yet, so they show as needing assignment.
async function seedDemoInvoicesWithoutReviewer(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  caseIds: string[],
  professionals: DemoProfessional[],
): Promise<void> {
  const [, , investigator, expert] = professionals;
  const waiting: Array<[string | undefined, DemoProfessional | undefined, string]> = [
    [caseIds[ASSIGNED_CASE_COUNT + 1], expert, 'Expert'],
    [caseIds[ASSIGNED_CASE_COUNT + 2], investigator, 'Investigator'],
  ];
  for (const [caseId, professional, kind] of waiting) {
    if (!caseId || !professional) {
      throw new Error('Expected demo cases and senders for the invoices without a reviewer.');
    }
    // eslint-disable-next-line no-await-in-loop
    await db.insert(caseAssignment).values({
      caseId,
      professionalId: professional.professionalId,
      assignedAt: faker.date.recent({ days: 90 }),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    const descriptions = DEMO_TIME_DESCRIPTIONS[kind]!;
    // eslint-disable-next-line no-await-in-loop
    await createInvoice(db, professional, {
      caseId,
      submit: true,
      attested: true,
      lines: [0, 1].map((i) => ({
        lineType: 'time' as const,
        serviceDate: faker.date.recent({ days: 30 }).toISOString().slice(0, 10),
        quantity: faker.number.float({ min: 1, max: 5, fractionDigits: 2 }),
        description: descriptions[i]!,
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
  // Warns, so the guided tour's day billed on two cases is flagged.
  await setBillingRule(db, fixtures.staffUserAccountId, 'daily_hour_cap', { enforcement: 'warn', parameters: { hours: 10 } });
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

// Closes one never-assigned case as "Close case" does, so the demo has a closed case.
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

// Assigns the case just past seedDemoAssignments' range to a demo staff member, as "Assign staff" does.
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

// Relative to today, so the demo's history stays recent.
function monthsAgo(months: number, day: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day, 15));
}

// Case and court numbers, pre-authorizations, an invoice billed above the configured rate, and invoices at each
// review state, one waiting long enough to be called out. All synthetic.
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
  // Granted over the past months, so the By county running total climbs.
  const grantedOn = [monthsAgo(10, 6), monthsAgo(8, 4), monthsAgo(6, 12), monthsAgo(4, 8)];
  for (const [index, assignment] of preauthorized.entries()) {
    const granted = grantedOn[index]!;
    // Pre-authorized at their configured rate.
    const configured = rates.filter((rate) => rate.professionalId === assignment.professionalId).at(-1)?.hourlyRate ?? '125.00';
    const approvedHourlyRate = index === 2 ? '125.00' : configured;
    const { preauthorizationId } = firstRow(
      // eslint-disable-next-line no-await-in-loop
      await db
        .insert(preauthorization)
        .values({
          caseId: assignment.caseId,
          professionalId: assignment.professionalId,
          statusId: approvedStatusId,
          requestedAmount: '2500.00',
          requestedAt: new Date(granted.getTime() - 24 * 60 * 60 * 1000),
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
      effectiveAt: granted,
      decidedAt: granted,
      decidedByUserAccountId: fixtures.staffUserAccountId,
    });
    if (index === 0) {
      // Raised once, for a ceiling revision on the chart and case page.
      const raised = monthsAgo(3, 18);
      // eslint-disable-next-line no-await-in-loop
      await db.insert(preauthorizationDecision).values({
        preauthorizationId,
        sequenceNumber: 2,
        outcomeId: approvedOutcomeId,
        approvedAmount: '4000.00',
        approvedHourlyRate,
        effectiveAt: raised,
        decidedAt: raised,
        decidedByUserAccountId: fixtures.staffUserAccountId,
        reason: 'Raised for a second round of interviews.',
      });
    }
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

  // Flagged as possible double billing on it: earlier March weeks here, and the 10th on another case.
  // Filed by person, so it doesn't count against the case's pre-authorization.
  const expertActor = { userAccountId: expert.userAccountId, professionalId: expert.professionalId };
  const firstHalf = await createInvoice(db, expertActor, {
    caseId: null,
    caseNumber: '26-CR-00245',
    attested: true,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-15',
    lines: [
      { lineType: 'time', serviceDate: '2026-03-03', quantity: 2, unitRate: 150, description: 'Reviewed the lab report and photographs' },
      { lineType: 'time', serviceDate: '2026-03-06', quantity: 1.5, unitRate: 150, description: 'Visited the lab to inspect the samples' },
    ],
  });
  await db
    .update(invoice)
    .set({ submittedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000) })
    .where(eq(invoice.invoiceId, firstHalf.invoiceId));
  for (const lineId of await lineIds(firstHalf.invoiceId)) {
    // eslint-disable-next-line no-await-in-loop
    await reviewInvoiceLine(db, reviewer, firstHalf.invoiceId, lineId, { outcome: 'approved' });
  }
  await finishReview(db, reviewer, firstHalf.invoiceId);
  await signOffInvoice(db, director, firstHalf.invoiceId, { outcome: 'approved' });
  await createInvoice(db, expertActor, {
    caseId: null,
    caseNumber: '26-CR-00252',
    attested: true,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    lines: [
      { lineType: 'time', serviceDate: '2026-03-10', quantity: 6, unitRate: 150, description: 'Testified at the suppression hearing' },
      { lineType: 'time', serviceDate: '2026-03-24', quantity: 1, unitRate: 150, description: 'Call with counsel after the hearing' },
    ],
  });

  // On the expert's case: one sent first and given to the demo sign-in, then
  // one on which a reviewer set the case's rate, waiting for the Director.
  // The first is flagged, since its default changed after it was sent.
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

// One possible duplicate to show the page: a colleague added again by staff,
// under another email, before anyone noticed they were already listed.
async function seedDemoPossibleDuplicate(staffUserAccountId: string, colleague: DemoProfessional): Promise<void> {
  const [row] = await db
    .select({ displayName: professional.displayName, professionalKindId: professional.professionalKindId })
    .from(professional)
    .where(eq(professional.professionalId, colleague.professionalId));
  if (!row?.displayName || !row.professionalKindId) {
    throw new Error('Expected the demo colleague to have a name and a role.');
  }
  await addProfessional(db, staffUserAccountId, {
    displayName: row.displayName,
    email: 'demo-vendor-2-office@example.invalid',
    professionalKindId: row.professionalKindId,
  });
}

// Signed-off invoices against the seeded pre-authorizations, backdated over the past months.
async function seedDemoPreauthorizedBilling(assignments: DemoAssignment[], staffUserAccountIds: string[]): Promise<void> {
  const [firstReviewer, , director] = staffUserAccountIds as [string, string, string];
  const rates = await listRates(db, assignments.slice(0, 4).map((assignment) => assignment.professionalId));
  const day = 24 * 60 * 60 * 1000;
  // [assignment, months ago worked, hours, day signed off the next month]; each within its ceiling (3's is nearly used).
  const billed: Array<[number, number, number[], number]> = [
    [0, 9, [3, 2.5], 11],
    [0, 7, [2, 1.5], 14],
    [1, 7, [2, 1], 27],
    [0, 5, [2], 9],
    [1, 4, [2.5], 20],
    [2, 3, [2.5, 2], 17],
    [0, 2, [3, 1.5], 8],
    [2, 2, [2], 22],
  ];
  /* eslint-disable no-await-in-loop */
  for (const [index, workedAgo, hours, signedOnDay] of billed) {
    const assignment = assignments[index]!;
    const actor = { userAccountId: assignment.userAccountId, professionalId: assignment.professionalId };
    const rate = Number(rates.filter((row) => row.professionalId === assignment.professionalId).at(-1)?.hourlyRate ?? '125.00');
    const descriptions = DEMO_TIME_DESCRIPTIONS[DEMO_VENDOR_KINDS[index % DEMO_VENDOR_KINDS.length]!]!;
    const month = monthsAgo(workedAgo, 1).toISOString().slice(0, 7);
    const { invoiceId } = await createInvoice(db, actor, {
      caseId: assignment.caseId,
      attested: true,
      periodStart: `${month}-01`,
      periodEnd: `${month}-28`,
      lines: hours.map((quantity, line) => ({
        lineType: 'time' as const,
        serviceDate: `${month}-${String(6 + line * 9).padStart(2, '0')}`,
        quantity,
        unitRate: rate,
        description: descriptions[line % descriptions.length]!,
      })),
    });
    const lines = await db.select({ id: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    for (const { id } of lines) {
      await reviewInvoiceLine(db, firstReviewer, invoiceId, id, { outcome: 'approved' });
    }
    await finishReview(db, firstReviewer, invoiceId);
    await signOffInvoice(db, director, invoiceId, { outcome: 'approved' });

    // Its whole history moved back: events a day apart ending at sign-off, the lines decided the day before.
    const signedOff = monthsAgo(workedAgo - 1, signedOnDay).getTime();
    const events = await db
      .select({ id: invoiceEvent.invoiceEventId, sequenceNumber: invoiceEvent.sequenceNumber })
      .from(invoiceEvent)
      .where(eq(invoiceEvent.invoiceId, invoiceId));
    const last = Math.max(...events.map((event) => event.sequenceNumber));
    for (const event of events) {
      await db
        .update(invoiceEvent)
        .set({ occurredAt: new Date(signedOff - (last - event.sequenceNumber) * day) })
        .where(eq(invoiceEvent.invoiceEventId, event.id));
    }
    const sent = new Date(signedOff - (last - Math.min(...events.map((event) => event.sequenceNumber))) * day);
    await db.update(invoice).set({ submittedAt: sent }).where(eq(invoice.invoiceId, invoiceId));
    await db.update(invoiceReviewAssignment).set({ assignedAt: sent }).where(eq(invoiceReviewAssignment.invoiceId, invoiceId));
    const chainIds = (
      await db.update(invoiceApprovalChain).set({ createdAt: sent }).where(eq(invoiceApprovalChain.invoiceId, invoiceId)).returning()
    ).map((chain) => chain.invoiceApprovalChainId);
    await db.update(invoiceAttestation).set({ attestedAt: sent }).where(inArray(invoiceAttestation.invoiceApprovalChainId, chainIds));
    await db
      .update(invoiceApprovalDecision)
      .set({ decidedAt: new Date(signedOff - day) })
      .where(and(inArray(invoiceApprovalDecision.invoiceApprovalChainId, chainIds), isNotNull(invoiceApprovalDecision.invoiceLineId)));
    await db
      .update(invoiceApprovalDecision)
      .set({ decidedAt: new Date(signedOff) })
      .where(and(inArray(invoiceApprovalDecision.invoiceApprovalChainId, chainIds), isNull(invoiceApprovalDecision.invoiceLineId)));
  }
  /* eslint-enable no-await-in-loop */
}

// A synthetic threshold and three requests: waiting for an answer, not needed, approved for less.
async function seedDemoPreauthorizationRequests(
  fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>,
  assignments: DemoAssignment[],
  professionals: DemoProfessional[],
): Promise<void> {
  const admin = fixtures.staffUserAccountId;
  await addThreshold(db, admin, { countyId: null, amount: 2000, effectiveFrom: '2025-01-01' });
  const settings = await getThresholdSettings(db);
  for (const kind of settings.kinds.filter((row) => row.displayName === 'Investigator' || row.displayName === 'Expert')) {
    // eslint-disable-next-line no-await-in-loop
    await setKindThresholdApplies(db, admin, kind.professionalKindId, { thresholdApplies: true });
  }
  const [first, second] = assignments;
  const investigator = professionals[2];
  const expert = professionals[3];
  if (!first || !second || !investigator || !expert) {
    throw new Error('Expected demo attorneys, an investigator and an expert.');
  }
  for (const [caseId, professionalId] of [
    [first.caseId, investigator.professionalId],
    [first.caseId, expert.professionalId],
    [second.caseId, investigator.professionalId],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await db.insert(caseAssignment).values({
      caseId,
      professionalId,
      assignedAt: new Date('2026-01-10T15:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: admin,
    });
  }
  const ask = async (attorney: DemoAssignment, professionalId: string, details: { service: string; rate: number | null; hours: number | null; amount: number; why: string }) =>
    createPreauthorizationRequest(db, await resolvePortalActor(db, attorney.userAccountId), {
      caseId: attorney.caseId,
      professionalId,
      serviceDescription: details.service,
      rateBasis: details.rate === null ? 'flat' : 'hourly',
      requestedRate: details.rate,
      estimatedQuantity: details.hours,
      requestedAmount: details.amount,
      justification: details.why,
    });
  const waiting = await ask(first, investigator.professionalId, {
    service: 'Witness interviews and scene work',
    rate: 95,
    hours: 50,
    amount: 4750,
    why: 'Several witnesses named in discovery have not been interviewed, and the scene needs photographing before it changes.',
  });
  await askRequestQuestion(db, admin, waiting.preauthorizationRequestId, { question: 'How many witnesses, and could some be interviewed by phone?' });
  const notNeeded = await ask(first, expert.professionalId, {
    service: 'Review of the lab report',
    rate: null,
    hours: null,
    amount: 1500,
    why: 'The lab report needs an independent review before the hearing.',
  });
  await decidePreauthorizationRequest(db, admin, notNeeded.preauthorizationRequestId, {
    outcome: 'not_needed',
    reason: 'This is within the county threshold, so no pre-authorization is needed.',
  });
  const approved = await ask(second, investigator.professionalId, {
    service: 'Records requests and follow-up interviews',
    rate: 95,
    hours: 40,
    amount: 3800,
    why: 'Records from two agencies are needed, and the people named in them should be interviewed.',
  });
  await decidePreauthorizationRequest(db, admin, approved.preauthorizationRequestId, {
    outcome: 'approved',
    approvedAmount: 3000,
    reason: 'Approved for the records and the first round of interviews. Ask again if more interviews are needed.',
  });
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
  await seedDemoTimeEntriesAndInvoices(assignments);
  await seedDemoMileage(fixtures, assignments);
  await seedClosedCase(fixtures, caseIds);
  await seedStaffAssignment(fixtures, caseIds, staffUserAccountIds);
  await seedDemoInvoicesWithoutReviewer(fixtures, caseIds, professionals);
  await seedDemoReview(fixtures, caseIds, assignments, staffUserAccountIds);
  await seedDemoPreauthorizationRequests(fixtures, assignments, professionals);
  await seedDemoPreauthorizedBilling(assignments, staffUserAccountIds);
  const [partner, colleague] = professionals;
  if (!partner || !colleague) {
    throw new Error('Expected two demo vendors for the uploads.');
  }
  await seedDemoUploads({ partner, colleague, staffUserAccountId: fixtures.staffUserAccountId });
  await seedDemoPossibleDuplicate(fixtures.staffUserAccountId, colleague);
  await seedDemoCaseStep(fixtures, professionals);
  return { caseCount: DEMO_CASE_COUNT, assignmentCount: assignments.length, staffCount: staffUserAccountIds.length };
}

// Each demo case is recorded as added from its first invoice (model/rules.yaml add_case_from_request), with an
// example of each of the case step's other outcomes.
async function seedDemoCaseStep(fixtures: Awaited<ReturnType<typeof resetAndSeedBaselineFixtures>>, professionals: DemoProfessional[]): Promise<void> {
  await db.update(invoice).set({ caseChoice: 'existing' }).where(isNotNull(invoice.caseId));
  await db.execute(sql`
    update ${caseTable} c set added_from_invoice_id = first.invoice_id
    from (select distinct on (case_id) case_id, invoice_id from ${invoice} where case_id is not null order by case_id, submitted_at nulls last) first
    where first.case_id = c.case_id`);
  await db.execute(sql`
    update ${caseLifecycleEvent} set reason_detail = 'Added from an invoice'
    where sequence_number = 1 and case_id in (select case_id from ${caseTable} where added_from_invoice_id is not null)`);
  // A number typed exactly as a case's, in that case's county.
  await db.execute(sql`
    update ${invoice} i set county_id = c.county_id
    from ${caseTable} c
    where i.case_id is null and c.county_id is not null
      and exists (
        select 1 from case_identifier ci
        where ci.case_id = c.case_id and upper(ci.value) = upper(coalesce(i.case_number_corrected, i.case_number_as_typed)))`);

  const staff = await resolvePortalActor(db, fixtures.staffUserAccountId);
  const [attorney, , investigator] = professionals;
  if (!attorney || !investigator) {
    throw new Error('Expected demo professionals for the case step.');
  }
  const [countyC] = await db.select({ countyId: county.countyId }).from(county).where(eq(county.displayName, 'County C'));
  const receipt = { filedByPerson: true, receivedVia: 'email', receivedOn: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) };
  const sendAs = async (input: { professionalId: string; caseNumber?: string; countyId: string; choice: 'new' | 'none'; lines: Array<{ lineType: 'time'; serviceDate: string; quantity: number; description: string }> }) => {
    const { invoiceId } = await createInvoice(db, staff, { caseId: null, professionalId: input.professionalId, submit: false, lines: input.lines });
    if (input.caseNumber) await setDraftCaseNumber(db, staff, invoiceId, { caseNumber: input.caseNumber });
    await setDraftCounty(db, staff, invoiceId, { countyId: input.countyId });
    await setDraftCaseChoice(db, staff, invoiceId, input.choice === 'new' ? { choice: 'new', confirmedNew: true } : { choice: 'none' });
    await submitInvoice(db, staff, invoiceId, receipt);
    await applyCaseChoiceAfterSend(db, fixtures.staffUserAccountId, invoiceId);
    return invoiceId;
  };

  // Not for one case: court observation, counted by its county alone.
  if (countyC) {
    await sendAs({
      professionalId: attorney.professionalId,
      countyId: countyC.countyId,
      choice: 'none',
      lines: [{ lineType: 'time', serviceDate: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), quantity: 3, description: 'Court observation' }],
    });
    await createPreauthorizationRequest(db, staff, {
      notForCase: true,
      countyId: countyC.countyId,
      professionalId: attorney.professionalId,
      serviceDescription: 'Court observation across the term',
      rateBasis: 'hourly',
      requestedRate: 95,
      estimatedQuantity: 12,
      requestedAmount: 1140,
      justification: 'Observing the calendar before several clients’ hearings; not for one case.',
      receivedVia: 'Email',
    });
  }

  // Added by mistake: a number written without its dashes, close to a case in the same county, said to be new.
  const [listed] = await db
    .select({ value: caseIdentifier.value, countyId: caseTable.countyId })
    .from(caseIdentifier)
    .innerJoin(caseTable, eq(caseIdentifier.caseId, caseTable.caseId))
    .where(and(eq(caseIdentifier.isPrimary, true), isNotNull(caseTable.countyId), isNull(caseTable.closedOn)))
    .orderBy(asc(caseIdentifier.value))
    .limit(1);
  if (listed?.countyId) {
    await sendAs({
      professionalId: investigator.professionalId,
      caseNumber: listed.value.replace(/-/g, ''),
      countyId: listed.countyId,
      choice: 'new',
      lines: [{ lineType: 'time', serviceDate: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), quantity: 2, description: 'Interviewed a witness' }],
    });
  }
}
