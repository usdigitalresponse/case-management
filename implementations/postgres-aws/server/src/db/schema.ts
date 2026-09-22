// Drizzle schema for the entity subset of model/schema.yaml in scope for
// this implementation (case intake + core read screens). See
// ../../MAPPING.md for what is deliberately out of scope and for
// implementation-specific additions (user_account.email).
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// --- reference_data lookup tables -----------------------------------------
// Simple code/display_name tables so seeded values stay traceable to
// model/schema.yaml `reference_data` fields, rather than hardcoded enums.

function referenceTable(name: string) {
  return pgTable(name, {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    displayName: text('display_name').notNull(),
    active: boolean('active').notNull().default(true),
  });
}

export const caseCategories = referenceTable('case_categories');
export const caseStatuses = referenceTable('case_statuses');
export const jurisdictions = referenceTable('jurisdictions');
export const languages = referenceTable('languages');
export const caseIdentifierTypes = referenceTable('case_identifier_types');
export const caseLifecycleEventTypes = referenceTable('case_lifecycle_event_types');
export const caseLifecycleReasons = referenceTable('case_lifecycle_reasons');

// --- core entities ----------------------------------------------------------

// model/schema.yaml: role.role_context must be one of case_participant,
// person_affiliation, case_assignment or user_account. Only
// case_participant and user_account contexts are exercised by this scope.
export const role = pgTable('role', {
  roleId: uuid('role_id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  roleContext: text('role_context').notNull(),
  active: boolean('active').notNull().default(true),
});

export const county = pgTable('county', {
  countyId: uuid('county_id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
});

export const organization = pgTable('organization', {
  organizationId: uuid('organization_id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
});

export const office = pgTable('office', {
  officeId: uuid('office_id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
  organizationId: uuid('organization_id').references(() => organization.organizationId),
});

// Person rows are seeded synthetic fixtures in this implementation; there
// is no create-person UI in scope (see ../../MAPPING.md).
export const person = pgTable('person', {
  personId: uuid('person_id').primaryKey().defaultRandom(),
  givenName: text('given_name'),
  middleName: text('middle_name'),
  familyName: text('family_name'),
  displayName: text('display_name').notNull(),
  dateOfBirth: date('date_of_birth'),
  email: text('email'),
});

// Effective membership of a person in an organization/office
// (model/schema.yaml: person_affiliation). Added ahead of need: cheaper to
// include now than to retrofit case_participant's uniqueness index later.
export const personAffiliation = pgTable('person_affiliation', {
  personAffiliationId: uuid('person_affiliation_id').primaryKey().defaultRandom(),
  personId: uuid('person_id').notNull().references(() => person.personId),
  organizationId: uuid('organization_id').notNull().references(() => organization.organizationId),
  officeId: uuid('office_id').references(() => office.officeId),
  affiliationRoleId: uuid('affiliation_role_id').references(() => role.roleId),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

// user_account.system_role_id configures a permission role; it grants no
// permission by itself (model/rules.yaml: validate_system_role). `email` is
// an implementation-specific addition (not in model/schema.yaml) used to
// match Google OAuth logins restricted to the USDR domain allowlist; rows
// are created on first successful login, not seeded with real addresses.
// This dev/demo login gate is not the government partner's production auth
// (see ../../MAPPING.md).
export const userAccount = pgTable('user_account', {
  userAccountId: uuid('user_account_id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
  email: text('email').notNull().unique(),
  personId: uuid('person_id').references(() => person.personId),
  systemRoleId: uuid('system_role_id').references(() => role.roleId),
});

export const caseTable = pgTable(
  'case',
  {
    caseId: uuid('case_id').primaryKey().defaultRandom(),
    // Compatibility reference to the person in the case's client role;
    // case_participant is authoritative (model/schema.yaml: case.client_id).
    clientId: uuid('client_id').references(() => person.personId),
    countyId: uuid('county_id').references(() => county.countyId),
    externalReference: text('external_reference'),
    caseCategoryId: uuid('case_category_id').references(() => caseCategories.id),
    statusId: uuid('status_id').notNull().references(() => caseStatuses.id),
    openedOn: date('opened_on'),
    closedOn: date('closed_on'),
    organizationId: uuid('organization_id').references(() => organization.organizationId),
    officeId: uuid('office_id').references(() => office.officeId),
    jurisdictionId: uuid('jurisdiction_id').references(() => jurisdictions.id),
    preferredLanguageId: uuid('preferred_language_id').references(() => languages.id),
  },
  (table) => [
    // Postgres doesn't auto-index FK columns; GET /api/cases filters on all
    // three (server/src/routes/cases.ts).
    index('case_county_id_idx').on(table.countyId),
    index('case_status_id_idx').on(table.statusId),
    index('case_category_id_idx').on(table.caseCategoryId),
  ],
);

export const caseParticipant = pgTable(
  'case_participant',
  {
    caseParticipantId: uuid('case_participant_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    personId: uuid('person_id').notNull().references(() => person.personId),
    participantRoleId: uuid('participant_role_id').notNull().references(() => role.roleId),
    affiliationId: uuid('affiliation_id').references(() => personAffiliation.personAffiliationId),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    // model/rules.yaml validate_case_children: reject duplicate open
    // relationships for the same case/person/role/affiliation. Note:
    // Postgres treats NULL as distinct in unique indexes, so two open rows
    // both omitting affiliation_id aren't caught here (see MAPPING.md).
    uniqueIndex('case_participant_open_unique')
      .on(table.caseId, table.personId, table.participantRoleId, table.affiliationId)
      .where(sql`ended_at IS NULL`),
    // The unique index above is partial (WHERE ended_at IS NULL) and can't
    // serve a plain case_id lookup (GET /api/cases/:id) — a separate plain
    // index is needed for that.
    index('case_participant_case_id_idx').on(table.caseId),
  ],
);

export const caseLifecycleEvent = pgTable(
  'case_lifecycle_event',
  {
    caseLifecycleEventId: uuid('case_lifecycle_event_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    sequenceNumber: integer('sequence_number').notNull(),
    eventTypeId: uuid('event_type_id').notNull().references(() => caseLifecycleEventTypes.id),
    resultingStatusId: uuid('resulting_status_id').notNull().references(() => caseStatuses.id),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    actorUserAccountId: uuid('actor_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    reasonId: uuid('reason_id').references(() => caseLifecycleReasons.id),
    reasonDetail: text('reason_detail'),
    referenceNumber: text('reference_number'),
    correctsEventId: uuid('corrects_event_id').references(
      (): AnyPgColumn => caseLifecycleEvent.caseLifecycleEventId,
    ),
  },
  (table) => [
    // Serialize events with a positive sequence unique within the case
    // (model/rules.yaml: preserve_case_lifecycle).
    uniqueIndex('case_lifecycle_event_case_sequence_unique').on(
      table.caseId,
      table.sequenceNumber,
    ),
  ],
);

// Named explicitly (not left to drizzle-kit's auto-generated naming) so
// src/intake/createCase.ts can import this constant instead of hand-typing
// a matching string to detect the constraint violation.
export const CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT =
  'case_identifier_issuer_type_value_unique';

export const caseIdentifier = pgTable(
  'case_identifier',
  {
    caseIdentifierId: uuid('case_identifier_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    identifierTypeId: uuid('identifier_type_id')
      .notNull()
      .references(() => caseIdentifierTypes.id),
    issuer: text('issuer').notNull(),
    value: text('value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    // Case identifier uniqueness is evaluated within issuer and identifier
    // type (model/rules.yaml: validate_case_children).
    uniqueIndex(CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT).on(
      table.issuer,
      table.identifierTypeId,
      table.value,
    ),
    // Allow at most one primary case identifier per case; primary is
    // optional (model/rules.yaml: validate_case_children).
    uniqueIndex('case_identifier_one_primary_per_case')
      .on(table.caseId)
      .where(sql`is_primary`),
    // The above is partial (WHERE is_primary) and can't serve a plain
    // case_id lookup (GET /api/cases/:id) — a separate plain index is
    // needed for that.
    index('case_identifier_case_id_idx').on(table.caseId),
  ],
);

// Postgres names an unnamed primary key `<table>_pkey` by convention (stable
// across regenerated migrations, since it derives from the table name, not
// column order); src/intake/createCase.ts imports this constant rather than
// hand-typing the same assumption.
export const INTAKE_REQUEST_PRIMARY_KEY_CONSTRAINT = 'intake_request_pkey';

// Dedupe table for client-supplied intake request IDs, so a retried
// POST /api/cases with the same request_id returns the original result
// instead of creating a second case (see ../intake/createCase.ts).
export const intakeRequest = pgTable('intake_request', {
  requestId: uuid('request_id').primaryKey(),
  caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
