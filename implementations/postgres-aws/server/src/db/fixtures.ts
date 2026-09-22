// Baseline synthetic fixtures shared between the dev/demo seed script
// (src/db/seed.ts) and the intake handler tests (__tests__/), so both reset
// to the same known state rather than maintaining two copies.
import { sql } from 'drizzle-orm';
import { faker } from '@faker-js/faker';
import type { Database } from './client';
import { firstRow } from './rowHelpers';
import {
  caseCategories,
  caseStatuses,
  jurisdictions,
  languages,
  caseIdentifierTypes,
  caseLifecycleEventTypes,
  caseLifecycleReasons,
  role,
  county,
  organization,
  office,
  person,
  userAccount,
} from './schema';
import {
  ROLE_IDS,
  ORGANIZATION_IDS,
  OFFICE_IDS,
  COUNTY_IDS,
  PERSON_IDS,
  USER_ACCOUNT_IDS,
} from './syntheticIds';

// LSC (Legal Services Corporation) Case Service Report major problem
// categories, matching the general shape of NCSC case-type standards —
// published, sector-wide taxonomies, not any organization's confidential
// configuration, so real category names are safe here.
const LSC_CASE_CATEGORIES = [
  { code: 'consumer_finance', displayName: 'Consumer/Finance' },
  { code: 'education', displayName: 'Education' },
  { code: 'employment', displayName: 'Employment' },
  { code: 'family', displayName: 'Family' },
  { code: 'health', displayName: 'Health' },
  { code: 'housing', displayName: 'Housing' },
  { code: 'individual_rights', displayName: 'Individual Rights' },
  { code: 'juvenile', displayName: 'Juvenile' },
  { code: 'income_maintenance', displayName: 'Income Maintenance' },
  { code: 'miscellaneous', displayName: 'Miscellaneous' },
  { code: 'utilities', displayName: 'Utilities' },
];

export interface BaselineFixtureIds {
  caseStatusOpenId: string;
  caseStatusClosedId: string;
  caseCategoryHousingId: string;
  jurisdictionSampleId: string;
  languageSampleId: string;
  identifierTypeSampleId: string;
  lifecycleEventTypeOpenId: string;
  lifecycleReasonIntakeId: string;
  clientParticipantRoleId: string;
  intakeStaffRoleId: string;
  countyId: string;
  organizationId: string;
  officeId: string;
  clientPersonId: string;
  staffPersonId: string;
  staffUserAccountId: string;
}

// Resets every table this implementation owns, then re-inserts a known-good
// baseline. Safe to call repeatedly (dev seed script) or between tests.
// TRUNCATE ... CASCADE resolves FK dependencies itself, so table order here
// doesn't matter (unlike a manually-ordered sequence of DELETEs).
export async function resetAndSeedBaselineFixtures(db: Database): Promise<BaselineFixtureIds> {
  // Fixed seed so Faker output (below) is deterministic across runs,
  // rather than changing every time this function is called.
  faker.seed(20260115);

  await db.execute(sql`
    TRUNCATE TABLE
      intake_request, case_identifier, case_lifecycle_event, case_participant, "case",
      user_account, person_affiliation, office, person, role, organization, county,
      case_categories, case_statuses, jurisdictions, languages, case_identifier_types,
      case_lifecycle_event_types, case_lifecycle_reasons
    RESTART IDENTITY CASCADE
  `);

  const [openStatus, closedStatus] = await db
    .insert(caseStatuses)
    .values([
      { code: 'sample_open', displayName: 'Sample Open' },
      { code: 'sample_closed', displayName: 'Sample Closed' },
    ])
    .returning();
  if (!openStatus || !closedStatus) {
    throw new Error('Expected case_statuses insert to return two rows.');
  }
  const insertedCategories = await db.insert(caseCategories).values(LSC_CASE_CATEGORIES).returning();
  const housingCategory = insertedCategories.find((row) => row.code === 'housing');
  if (!housingCategory) {
    throw new Error('Expected an LSC_CASE_CATEGORIES row with code "housing".');
  }
  const jurisdiction = firstRow(
    await db
      .insert(jurisdictions)
      .values([{ code: 'sample_jurisdiction', displayName: 'Sample Jurisdiction' }])
      .returning(),
  );
  const language = firstRow(
    await db.insert(languages).values([{ code: 'sample_english', displayName: 'Sample English' }]).returning(),
  );
  const identifierType = firstRow(
    await db
      .insert(caseIdentifierTypes)
      .values([{ code: 'sample_reference', displayName: 'Sample Reference' }])
      .returning(),
  );
  const eventType = firstRow(
    await db
      .insert(caseLifecycleEventTypes)
      .values([{ code: 'sample_open', displayName: 'Sample Open' }])
      .returning(),
  );
  const reason = firstRow(
    await db
      .insert(caseLifecycleReasons)
      .values([{ code: 'sample_intake', displayName: 'Sample Intake' }])
      .returning(),
  );

  await db.insert(role).values([
    {
      roleId: ROLE_IDS.CLIENT_PARTICIPANT,
      displayName: 'Client',
      roleContext: 'case_participant',
      active: true,
    },
    {
      roleId: ROLE_IDS.INTAKE_STAFF_ACCOUNT,
      displayName: 'Intake Staff',
      roleContext: 'user_account',
      active: true,
    },
  ]);

  await db
    .insert(county)
    .values([{ countyId: COUNTY_IDS.SAMPLE_COUNTY_A, displayName: 'Sample County A', active: true }]);
  await db.insert(organization).values([
    { organizationId: ORGANIZATION_IDS.SAMPLE_ORG_A, displayName: 'Sample Organization A', active: true },
  ]);
  await db.insert(office).values([
    {
      officeId: OFFICE_IDS.SAMPLE_OFFICE_A,
      displayName: 'Sample Office A',
      organizationId: ORGANIZATION_IDS.SAMPLE_ORG_A,
      active: true,
    },
  ]);

  // Faker-generated names — no provenance link to any real dataset. Person
  // creation is out of scope for this slice (see ../../MAPPING.md); these
  // are the only two person rows that exist.
  const clientGivenName = faker.person.firstName();
  const clientFamilyName = faker.person.lastName();
  const staffGivenName = faker.person.firstName();
  const staffFamilyName = faker.person.lastName();
  await db.insert(person).values([
    {
      personId: PERSON_IDS.SYNTHETIC_CLIENT,
      givenName: clientGivenName,
      familyName: clientFamilyName,
      displayName: `${clientGivenName} ${clientFamilyName}`,
    },
    {
      personId: PERSON_IDS.SYNTHETIC_STAFF,
      givenName: staffGivenName,
      familyName: staffFamilyName,
      displayName: `${staffGivenName} ${staffFamilyName}`,
    },
  ]);

  // A synthetic dev-only account (example.invalid domain, per
  // scenarios/fixtures conventions) used for local testing without a real
  // Google OAuth login. Real accounts are created on first OAuth login,
  // matched by email (see ../auth).
  await db.insert(userAccount).values([
    {
      userAccountId: USER_ACCOUNT_IDS.SYNTHETIC_STAFF,
      displayName: 'Synthetic Account Staff',
      active: true,
      email: 'staff@example.invalid',
      personId: PERSON_IDS.SYNTHETIC_STAFF,
      systemRoleId: ROLE_IDS.INTAKE_STAFF_ACCOUNT,
    },
  ]);

  return {
    caseStatusOpenId: openStatus.id,
    caseStatusClosedId: closedStatus.id,
    caseCategoryHousingId: housingCategory.id,
    jurisdictionSampleId: jurisdiction.id,
    languageSampleId: language.id,
    identifierTypeSampleId: identifierType.id,
    lifecycleEventTypeOpenId: eventType.id,
    lifecycleReasonIntakeId: reason.id,
    clientParticipantRoleId: ROLE_IDS.CLIENT_PARTICIPANT,
    intakeStaffRoleId: ROLE_IDS.INTAKE_STAFF_ACCOUNT,
    countyId: COUNTY_IDS.SAMPLE_COUNTY_A,
    organizationId: ORGANIZATION_IDS.SAMPLE_ORG_A,
    officeId: OFFICE_IDS.SAMPLE_OFFICE_A,
    clientPersonId: PERSON_IDS.SYNTHETIC_CLIENT,
    staffPersonId: PERSON_IDS.SYNTHETIC_STAFF,
    staffUserAccountId: USER_ACCOUNT_IDS.SYNTHETIC_STAFF,
  };
}
