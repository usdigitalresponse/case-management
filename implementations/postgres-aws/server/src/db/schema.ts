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
  numeric,
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

export type ReferenceTable = ReturnType<typeof referenceTable>;

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
export const activityTypes = referenceTable('activity_types');
export const invoiceStatuses = referenceTable('invoice_statuses');
export const invoiceLineTypes = referenceTable('invoice_line_types');
export const invoiceApprovalStepTypes = referenceTable('invoice_approval_step_types');
export const invoiceApprovalOutcomes = referenceTable('invoice_approval_outcomes');

// --- core entities ----------------------------------------------------------

// model/schema.yaml: role.role_context must be one of case_participant,
// person_affiliation, case_assignment or user_account. Only
// case_participant and user_account contexts are exercised by this scope.
export const role = pgTable(
  'role',
  {
    roleId: uuid('role_id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    roleContext: text('role_context').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    // Lets ../db/ensureReferenceData.ts seed a role idempotently
    // (insert ... on conflict do nothing).
    uniqueIndex('role_display_name_role_context_unique').on(table.displayName, table.roleContext),
  ],
);

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
// match logins (SSO, restricted to each provider's domain allowlist, or
// magic link); rows are created on first successful login, not seeded with
// real addresses.
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

// Named explicitly so ../professionals/ensureProfessional.ts can recover
// from the constraint violation a concurrent first-login race produces,
// rather than silently creating two professional rows for one account.
export const PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT = 'professional_user_account_id_unique';

// model/schema.yaml: professional.qualification_level_id (a reference_data
// classification) is deliberately omitted — qualification-based assignment
// checks (require_qualification_for_assignment in model/rules.yaml) aren't
// implemented yet; see ../../MAPPING.md. Every professional row here is
// bootstrapped on first login (either kind, see ../auth), not created
// through a dedicated form.
export const professional = pgTable(
  'professional',
  {
    professionalId: uuid('professional_id').primaryKey().defaultRandom(),
    userAccountId: uuid('user_account_id').references(() => userAccount.userAccountId),
    personId: uuid('person_id').notNull().references(() => person.personId),
    displayName: text('display_name'),
    active: boolean('active').notNull().default(true),
    officeId: uuid('office_id').references(() => office.officeId),
  },
  (table) => [
    // Postgres unique indexes treat NULL as distinct from every other
    // value, so multiple professional rows with no user_account_id (a
    // future staff-created profile with no login yet) remain possible —
    // only a concurrent bootstrap for the *same* account is prevented.
    uniqueIndex(PROFESSIONAL_USER_ACCOUNT_ID_UNIQUE_CONSTRAINT).on(table.userAccountId),
  ],
);

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

// Named explicitly so ../routes/cases.ts can recognize a double-click/
// retry collision on POST /:id/external-assignments and recover instead
// of surfacing a raw constraint-violation error.
export const CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT = 'case_assignment_open_unique';

// model/rules.yaml's require_qualification_for_assignment and
// review_workload_before_assignment (both `outcome: configurable`) are not
// implemented — any professional can be assigned to any case here; see
// ../../MAPPING.md. validate_effective_relationships' "at most one
// overlapping primary assignment per case" is also not enforced yet (would
// need a partial unique index keyed on a to-be-added "primary" flag).
export const caseAssignment = pgTable(
  'case_assignment',
  {
    caseAssignmentId: uuid('case_assignment_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    professionalId: uuid('professional_id').notNull().references(() => professional.professionalId),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    assignmentRoleId: uuid('assignment_role_id').notNull().references(() => role.roleId),
    affiliationId: uuid('affiliation_id').references(() => personAffiliation.personAffiliationId),
    assignedByUserAccountId: uuid('assigned_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    endedByUserAccountId: uuid('ended_by_user_account_id').references(() => userAccount.userAccountId),
    endReason: text('end_reason'),
  },
  (table) => [
    // GET /api/my-cases filters by professionalId; the assignment route
    // filters by caseId.
    index('case_assignment_professional_id_idx').on(table.professionalId),
    index('case_assignment_case_id_idx').on(table.caseId),
    // At most one open assignment per case/professional pair — the same
    // "open relationship" pattern as case_participant_open_unique below,
    // guarding against a double-click/retry on
    // POST /:id/external-assignments creating two open rows (and the
    // case appearing twice in GET /api/my-cases).
    uniqueIndex(CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT)
      .on(table.caseId, table.professionalId)
      .where(sql`ended_at IS NULL`),
  ],
);

// model/schema.yaml: time_entry.activity_id/office_id/case_program_id/
// case_funding_id are deliberately omitted — none of those concepts
// (activities, programs, funding) have tables here yet; see
// ../../MAPPING.md.
export const timeEntry = pgTable(
  'time_entry',
  {
    timeEntryId: uuid('time_entry_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    professionalId: uuid('professional_id').notNull().references(() => professional.professionalId),
    activityTypeId: uuid('activity_type_id').notNull().references(() => activityTypes.id),
    activityOn: date('activity_on').notNull(),
    durationHours: numeric('duration_hours', { precision: 6, scale: 2 }).notNull(),
    description: text('description').notNull(),
  },
  (table) => [
    // GET /api/portal/time-entries filters by caseId for the caller's own
    // entries.
    index('time_entry_case_id_idx').on(table.caseId),
    index('time_entry_professional_id_idx').on(table.professionalId),
  ],
);

// model/schema.yaml: invoice.service_provider_id (required, references a
// service_provider entity) has no table here — professional already
// plays that role for external submitters (see
// ../professionals/ensureProfessional.ts), so professionalId stands in
// for it. invoice_line.source_expense_id is omitted (no expense table;
// out of scope for this slice — time and invoices only, no expense
// tracking).
export const invoice = pgTable(
  'invoice',
  {
    invoiceId: uuid('invoice_id').primaryKey().defaultRandom(),
    submittedByUserAccountId: uuid('submitted_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    professionalId: uuid('professional_id').notNull().references(() => professional.professionalId),
    statusId: uuid('status_id').notNull().references(() => invoiceStatuses.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // Frozen at submit time, computed from invoice_line amounts rather
    // than trusted from the client (model/rules.yaml:
    // validate_invoice_total) — see ../portal/createInvoice.ts.
    submittedTotal: numeric('submitted_total', { precision: 12, scale: 2 }).notNull(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    currencyCode: text('currency_code').notNull().default('USD'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
  },
  (table) => [index('invoice_professional_id_idx').on(table.professionalId), index('invoice_case_id_idx').on(table.caseId)],
);

export const invoiceLine = pgTable(
  'invoice_line',
  {
    invoiceLineId: uuid('invoice_line_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    lineTypeId: uuid('line_type_id').notNull().references(() => invoiceLineTypes.id),
    // Context only, not used to derive `amount` — the submitter states
    // the amount directly (there's no billing-rate entity to derive it
    // from); see ../portal/createInvoice.ts.
    sourceTimeEntryId: uuid('source_time_entry_id').references(() => timeEntry.timeEntryId),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [index('invoice_line_invoice_id_idx').on(table.invoiceId)],
);

// Single-stage slice of the canonical approval chain: one chain per invoice,
// one line_review decision (sequence_number 1) per line. No pre-approval,
// further stages, "requests changes" or superseding; see ../../MAPPING.md.
export const invoiceApprovalChain = pgTable(
  'invoice_approval_chain',
  {
    invoiceApprovalChainId: uuid('invoice_approval_chain_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    createdByUserAccountId: uuid('created_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    // Never set yet; kept to match model/schema.yaml.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('invoice_approval_chain_current_uidx')
      .on(table.invoiceId)
      .where(sql`superseded_at IS NULL`),
  ],
);

export const invoiceApprovalDecision = pgTable(
  'invoice_approval_decision',
  {
    invoiceApprovalDecisionId: uuid('invoice_approval_decision_id').primaryKey().defaultRandom(),
    invoiceApprovalChainId: uuid('invoice_approval_chain_id')
      .notNull()
      .references(() => invoiceApprovalChain.invoiceApprovalChainId),
    sequenceNumber: integer('sequence_number').notNull(),
    stepTypeId: uuid('step_type_id').notNull().references(() => invoiceApprovalStepTypes.id),
    // Null only on legacy whole-invoice decisions.
    invoiceLineId: uuid('invoice_line_id').references(() => invoiceLine.invoiceLineId),
    outcomeId: uuid('outcome_id').notNull().references(() => invoiceApprovalOutcomes.id),
    decidedByUserAccountId: uuid('decided_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    // Rejection reason and approved amount (at most the line amount) are
    // required per outcome by ../billing/reviewInvoiceLine.ts.
    reason: text('reason'),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
  },
  (table) => [
    uniqueIndex('invoice_approval_decision_line_uidx').on(
      table.invoiceApprovalChainId,
      table.sequenceNumber,
      table.invoiceLineId,
    ),
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

// Implementation-specific addition, not in model/schema.yaml (see
// ../../MAPPING.md "Implementation-specific additions") — backs the
// external-user magic-link sign-in (../auth/magicLink.ts). Stores only a
// hash of the token, never the token itself, so a DB read (backup, replica,
// leaked row) can't be replayed into a session.
export const magicLinkToken = pgTable('magic_link_token', {
  magicLinkTokenId: uuid('magic_link_token_id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
