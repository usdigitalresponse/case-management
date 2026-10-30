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
  jsonb,
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
export const expenseTypes = referenceTable('expense_types');
export const invoiceApprovalStepTypes = referenceTable('invoice_approval_step_types');
export const invoiceApprovalOutcomes = referenceTable('invoice_approval_outcomes');
export const invoiceEventTypes = referenceTable('invoice_event_types');
// Why a line was approved in part or rejected (model/rules.yaml decide_invoice_lines).
// applies_to: which outcome lists a reason, 'approved_in_part', 'rejected'
// or 'both' (model/rules.yaml decide_invoice_lines).
export const invoiceDecisionReasons = pgTable('invoice_decision_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
  appliesTo: text('applies_to').notNull().default('both'),
});
// How a request staff entered reached the organization (model/rules.yaml authorize_staff_invoice_entry).
export const invoiceReceiptChannels = referenceTable('invoice_receipt_channels');
export const preauthorizationStatuses = referenceTable('preauthorization_statuses');
export const preauthorizationOutcomes = referenceTable('preauthorization_outcomes');
export const invoiceImportFormats = referenceTable('invoice_import_formats');
export const invoiceImportStatuses = referenceTable('invoice_import_statuses');
// Administrator-maintained (../billing/professionalRates.ts); none are seeded.
export const professionalKinds = referenceTable('professional_kinds');
// Task codes for the billing codes rule; administrator-maintained.
export const billingCodes = referenceTable('billing_codes');

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
    // Whose rates price this professional's time.
    professionalKindId: uuid('professional_kind_id').references(() => professionalKinds.id),
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
    sourceInvoiceImportId: uuid('source_invoice_import_id').references(
      (): AnyPgColumn => invoiceImport.invoiceImportId,
    ),
    // The professional, or a delegate acting for them (model/rules.yaml
    // authorize_delegated_submission). Absent on entries from before 0.4.0.
    recordedByUserAccountId: uuid('recorded_by_user_account_id').references(() => userAccount.userAccountId),
  },
  (table) => [
    // GET /api/portal/time-entries filters by caseId for the caller's own
    // entries.
    index('time_entry_case_id_idx').on(table.caseId),
    index('time_entry_professional_id_idx').on(table.professionalId),
  ],
);

// Insert-only. So far it records only time entry changes and deletions
// (../portal/changeTimeEntry.ts); other entities keep their own event tables.
export const auditEvent = pgTable(
  'audit_event',
  {
    auditEventId: uuid('audit_event_id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    eventType: text('event_type').notNull(),
    actorUserAccountId: uuid('actor_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    priorValues: jsonb('prior_values'),
  },
  (table) => [index('audit_event_entity_idx').on(table.entityType, table.entityId)],
);

// Insert-only: a new rate takes over from its date (model/rules.yaml
// apply_professional_rates; ../billing/professionalRates.ts).
export const professionalKindRate = pgTable(
  'professional_kind_rate',
  {
    professionalKindRateId: uuid('professional_kind_rate_id').primaryKey().defaultRandom(),
    professionalKindId: uuid('professional_kind_id')
      .notNull()
      .references(() => professionalKinds.id),
    hourlyRate: numeric('hourly_rate', { precision: 12, scale: 2 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    recordedByUserAccountId: uuid('recorded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('professional_kind_rate_kind_idx').on(table.professionalKindId, table.effectiveFrom)],
);

// Insert-only, like professional_kind_rate (model/rules.yaml
// apply_mileage_rates; ../billing/mileageRates.ts).
export const mileageRate = pgTable(
  'mileage_rate',
  {
    mileageRateId: uuid('mileage_rate_id').primaryKey().defaultRandom(),
    ratePerMile: numeric('rate_per_mile', { precision: 8, scale: 3 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    recordedByUserAccountId: uuid('recorded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('mileage_rate_effective_idx').on(table.effectiveFrom)],
);

// Every routing lookup, kept as a cache by address pair and to count each
// month's calls (../billing/routeCheck.ts). Implementation-only.
export const routeCheck = pgTable(
  'route_check',
  {
    routeCheckId: uuid('route_check_id').primaryKey().defaultRandom(),
    pairKey: text('pair_key').notNull(),
    // found, not_found or error; only error is retried.
    outcome: text('outcome').notNull(),
    // One way, in miles.
    distanceMiles: numeric('distance_miles', { precision: 10, scale: 1 }),
    apiCalls: integer('api_calls').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('route_check_pair_idx').on(table.pairKey), index('route_check_checked_at_idx').on(table.checkedAt)],
);

// Insert-only; the latest row per rule is in force (model/rules.yaml
// apply_billing_rules; ../billing/billingRules.ts). rule_code is one of the
// rules defined there rather than a reference table.
export const billingRuleSetting = pgTable(
  'billing_rule_setting',
  {
    billingRuleSettingId: uuid('billing_rule_setting_id').primaryKey().defaultRandom(),
    ruleCode: text('rule_code').notNull(),
    enforcement: text('enforcement').notNull(),
    parameters: jsonb('parameters'),
    recordedByUserAccountId: uuid('recorded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('billing_rule_setting_rule_idx').on(table.ruleCode, table.recordedAt)],
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
    // Null only on a staff draft in intake whose professional is chosen when
    // it is matched to a case (model/rules.yaml match_invoice_to_case).
    professionalId: uuid('professional_id').references(() => professional.professionalId),
    statusId: uuid('status_id').notNull().references(() => invoiceStatuses.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // Frozen at submit time, computed from invoice_line amounts rather
    // than trusted from the client (model/rules.yaml:
    // validate_invoice_total) — see ../portal/createInvoice.ts.
    submittedTotal: numeric('submitted_total', { precision: 12, scale: 2 }).notNull(),
    // Null while staff hold an invoice in intake, or when they review one
    // without a case (model/rules.yaml match_invoice_to_case).
    caseId: uuid('case_id').references(() => caseTable.caseId),
    currencyCode: text('currency_code').notNull().default('USD'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    // Set when staff entered a request received outside the system;
    // waiting time counts from receivedOn.
    receivedViaId: uuid('received_via_id').references(() => invoiceReceiptChannels.id),
    receivedOn: date('received_on'),
    // Entered by a submitter whose case or provider wasn't listed; kept
    // after matching (model/rules.yaml match_invoice_to_case).
    proposedCase: jsonb('proposed_case').$type<{ clientName: string; caseNumber?: string; details?: string }>(),
    proposedProvider: jsonb('proposed_provider').$type<{ displayName: string; email?: string; professionalKindId?: string }>(),
  },
  (table) => [index('invoice_professional_id_idx').on(table.professionalId), index('invoice_case_id_idx').on(table.caseId)],
);

export const invoiceLine = pgTable(
  'invoice_line',
  {
    invoiceLineId: uuid('invoice_line_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    // The invoice's case; null with it.
    caseId: uuid('case_id').references(() => caseTable.caseId),
    lineTypeId: uuid('line_type_id').notNull().references(() => invoiceLineTypes.id),
    // Every submitted time line has one (../imports/importedTimeEntries.ts).
    sourceTimeEntryId: uuid('source_time_entry_id').references(() => timeEntry.timeEntryId),
    // On a time or mileage line, quantity × billedRate (../billing/priceLines.ts).
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    serviceDate: date('service_date'),
    // Filled from the billing period on import (../imports/inferServiceDates.ts).
    serviceDateInferred: boolean('service_date_inferred').notNull().default(false),
    description: text('description'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }),
    // Supplier-stated; on a time line it is the billed rate.
    unitRate: numeric('unit_rate', { precision: 12, scale: 2 }),
    statedAmount: numeric('stated_amount', { precision: 12, scale: 2 }),
    // Three places for a per-mile rate.
    billedRate: numeric('billed_rate', { precision: 12, scale: 3 }),
    // Time lines: the professional kind's rate on the service date, for the rate check.
    configuredRate: numeric('configured_rate', { precision: 12, scale: 2 }),
    timekeeperLabel: text('timekeeper_label'),
    // Whom the submitter matched the label to.
    timekeeperProfessionalId: uuid('timekeeper_professional_id').references(
      () => professional.professionalId,
    ),
    // Named by a submitter because they weren't listed; kept after matching.
    proposedTimekeeperName: text('proposed_timekeeper_name'),
    proposedTimekeeperEmail: text('proposed_timekeeper_email'),
    taskCode: text('task_code'),
    activityCode: text('activity_code'),
    expenseCode: text('expense_code'),
    // Mileage is an expense line with the mileage type; its quantity is miles.
    expenseTypeId: uuid('expense_type_id').references(() => expenseTypes.id),
    tripOrigin: text('trip_origin'),
    tripDestination: text('trip_destination'),
    roundTrip: boolean('round_trip').notNull().default(false),
    // One-way driving distance in miles, from ../billing/routeCheck.ts.
    routeDistance: numeric('route_distance', { precision: 10, scale: 1 }),
    routeCheckedAt: timestamp('route_checked_at', { withTimezone: true }),
    // The import's line or row it was read from; null if the submitter added it.
    sourceLocation: text('source_location'),
  },
  (table) => [index('invoice_line_invoice_id_idx').on(table.invoiceId)],
);

// Immutable request history (model/rules.yaml validate_payment_request).
export const invoiceEvent = pgTable(
  'invoice_event',
  {
    invoiceEventId: uuid('invoice_event_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    invoiceApprovalChainId: uuid('invoice_approval_chain_id').references(
      () => invoiceApprovalChain.invoiceApprovalChainId,
    ),
    sequenceNumber: integer('sequence_number').notNull(),
    eventTypeId: uuid('event_type_id').notNull().references(() => invoiceEventTypes.id),
    resultingStatusId: uuid('resulting_status_id').notNull().references(() => invoiceStatuses.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // Null only for system actions (import expiry), which carry a reason.
    actorUserAccountId: uuid('actor_user_account_id').references(() => userAccount.userAccountId),
    reason: text('reason'),
  },
  (table) => [uniqueIndex('invoice_event_invoice_sequence_unique').on(table.invoiceId, table.sequenceNumber)],
);

// File content lives outside Postgres (model/rules.yaml validate_documents).
export const document = pgTable(
  'document',
  {
    documentId: uuid('document_id').primaryKey().defaultRandom(),
    storageReference: text('storage_reference').notNull(),
    displayName: text('display_name').notNull(),
    mediaType: text('media_type').notNull(),
    contentHash: text('content_hash').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    recordedByUserAccountId: uuid('recorded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    supersedesDocumentId: uuid('supersedes_document_id').references(
      (): AnyPgColumn => document.documentId,
    ),
    // Content deleted; metadata and hash stay for duplicate detection.
    contentDeletedAt: timestamp('content_deleted_at', { withTimezone: true }),
  },
  (table) => [index('document_content_hash_idx').on(table.contentHash)],
);

export const invoiceImport = pgTable(
  'invoice_import',
  {
    invoiceImportId: uuid('invoice_import_id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').notNull().references(() => document.documentId),
    uploadedByUserAccountId: uuid('uploaded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
    caseId: uuid('case_id').references(() => caseTable.caseId),
    // For a file held with no case: a hint for Intake, checked on matching.
    suggestedCaseId: uuid('suggested_case_id').references(() => caseTable.caseId),
    suggestedProfessionalId: uuid('suggested_professional_id').references(() => professional.professionalId),
    sourceFormatId: uuid('source_format_id').notNull().references(() => invoiceImportFormats.id),
    statusId: uuid('status_id').notNull().references(() => invoiceImportStatuses.id),
    extractionMethod: text('extraction_method'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    extractionResult: jsonb('extraction_result'),
    invoiceId: uuid('invoice_id').references(() => invoice.invoiceId),
    resolvedByUserAccountId: uuid('resolved_by_user_account_id').references(
      () => userAccount.userAccountId,
    ),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('invoice_import_uploaded_by_idx').on(table.uploadedByUserAccountId),
    // At most one import per draft request.
    uniqueIndex('invoice_import_invoice_id_uidx').on(table.invoiceId),
  ],
);

// The submitter's confirmation that an attempt is true and correct, bound to
// that attempt; a resubmission needs a new one.
export const invoiceAttestation = pgTable(
  'invoice_attestation',
  {
    invoiceAttestationId: uuid('invoice_attestation_id').primaryKey().defaultRandom(),
    invoiceApprovalChainId: uuid('invoice_approval_chain_id')
      .notNull()
      .references(() => invoiceApprovalChain.invoiceApprovalChainId),
    attestorPersonId: uuid('attestor_person_id').notNull().references(() => person.personId),
    recordedByUserAccountId: uuid('recorded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    attestedAt: timestamp('attested_at', { withTimezone: true }).notNull(),
    statement: text('statement').notNull(),
    signatureDocumentId: uuid('signature_document_id').references(() => document.documentId),
  },
  (table) => [index('invoice_attestation_chain_idx').on(table.invoiceApprovalChainId)],
);

// The supplier's own invoice behind a payment request, such as the number
// on an uploaded file; no workflow of its own.
export const supportingInvoice = pgTable(
  'supporting_invoice',
  {
    supportingInvoiceId: uuid('supporting_invoice_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    invoiceNumber: text('invoice_number').notNull(),
    issuedOn: date('issued_on'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    documentId: uuid('document_id').references(() => document.documentId),
  },
  (table) => [index('supporting_invoice_invoice_id_idx').on(table.invoiceId)],
);

// One chain per submission attempt. Each finished round of line review is a
// sequence_number with a decision per line; sign-off decisions follow it.
// No pre-approval; see ../../MAPPING.md.
export const invoiceApprovalChain = pgTable(
  'invoice_approval_chain',
  {
    invoiceApprovalChainId: uuid('invoice_approval_chain_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    createdByUserAccountId: uuid('created_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    // Set when the submitter recalls this attempt.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    // Null only on chains created before snapshots existed.
    submissionSnapshot: jsonb('submission_snapshot'),
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
    // Null on sign-off decisions, which cover the invoice.
    invoiceLineId: uuid('invoice_line_id').references(() => invoiceLine.invoiceLineId),
    outcomeId: uuid('outcome_id').notNull().references(() => invoiceApprovalOutcomes.id),
    decidedByUserAccountId: uuid('decided_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    // The note, or a sign-off comment.
    reason: text('reason'),
    reasonCodeId: uuid('reason_code_id').references(() => invoiceDecisionReasons.id),
    // Staff-only comment (model/rules.yaml limit_review_comment_visibility).
    internalOnly: boolean('internal_only').notNull().default(false),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    approvedQuantity: numeric('approved_quantity', { precision: 10, scale: 2 }),
    approvedRate: numeric('approved_rate', { precision: 12, scale: 3 }),
  },
  (table) => [
    uniqueIndex('invoice_approval_decision_line_uidx').on(
      table.invoiceApprovalChainId,
      table.sequenceNumber,
      table.invoiceLineId,
    ),
    // One sign-off decision per sequence number.
    uniqueIndex('invoice_approval_decision_invoice_uidx')
      .on(table.invoiceApprovalChainId, table.sequenceNumber)
      .where(sql`invoice_line_id IS NULL`),
  ],
);

// Changeable, unaudited decisions during a round of review
// (model/rules.yaml decide_invoice_lines); cleared when the round is finished.
export const invoiceLineWorkingDecision = pgTable(
  'invoice_line_working_decision',
  {
    invoiceLineWorkingDecisionId: uuid('invoice_line_working_decision_id').primaryKey().defaultRandom(),
    invoiceApprovalChainId: uuid('invoice_approval_chain_id')
      .notNull()
      .references(() => invoiceApprovalChain.invoiceApprovalChainId),
    invoiceLineId: uuid('invoice_line_id')
      .notNull()
      .references(() => invoiceLine.invoiceLineId),
    outcomeId: uuid('outcome_id').notNull().references(() => invoiceApprovalOutcomes.id),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    approvedQuantity: numeric('approved_quantity', { precision: 10, scale: 2 }),
    approvedRate: numeric('approved_rate', { precision: 12, scale: 3 }),
    reasonCodeId: uuid('reason_code_id').references(() => invoiceDecisionReasons.id),
    note: text('note'),
    decidedByUserAccountId: uuid('decided_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('invoice_line_working_decision_line_uidx').on(table.invoiceApprovalChainId, table.invoiceLineId)],
);

// Who holds each review step; ended rows are the history
// (model/rules.yaml assign_invoice_review).
export const invoiceReviewAssignment = pgTable(
  'invoice_review_assignment',
  {
    invoiceReviewAssignmentId: uuid('invoice_review_assignment_id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id').notNull().references(() => invoice.invoiceId),
    stepTypeId: uuid('step_type_id').notNull().references(() => invoiceApprovalStepTypes.id),
    position: integer('position').notNull(),
    assignedUserAccountId: uuid('assigned_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull(),
    // Null when a configured default assigned it on submission.
    assignedByUserAccountId: uuid('assigned_by_user_account_id').references(() => userAccount.userAccountId),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedByUserAccountId: uuid('ended_by_user_account_id').references(() => userAccount.userAccountId),
  },
  (table) => [
    index('invoice_review_assignment_invoice_idx').on(table.invoiceId),
    index('invoice_review_assignment_user_idx').on(table.assignedUserAccountId),
    uniqueIndex('invoice_review_assignment_open_uidx')
      .on(table.invoiceId, table.stepTypeId, table.position)
      .where(sql`ended_at IS NULL`),
  ],
);

// Where new invoices on a case go, ahead of the configured default.
export const caseInvoiceReviewer = pgTable(
  'case_invoice_reviewer',
  {
    caseInvoiceReviewerId: uuid('case_invoice_reviewer_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    reviewerUserAccountId: uuid('reviewer_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    setAt: timestamp('set_at', { withTimezone: true }).notNull(),
    setByUserAccountId: uuid('set_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('case_invoice_reviewer_open_uidx').on(table.caseId).where(sql`ended_at IS NULL`)],
);

// An external-service ceiling for one case, here for one professional, as
// invoice.professional_id stands in for the service provider. Read-only in
// this implementation: rows come from seed data (../../MAPPING.md).
export const preauthorization = pgTable(
  'preauthorization',
  {
    preauthorizationId: uuid('preauthorization_id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull().references(() => caseTable.caseId),
    professionalId: uuid('professional_id').references(() => professional.professionalId),
    statusId: uuid('status_id').notNull().references(() => preauthorizationStatuses.id),
    requestedAmount: numeric('requested_amount', { precision: 12, scale: 2 }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    authorizationNumber: text('authorization_number'),
    currencyCode: text('currency_code').notNull().default('USD'),
  },
  (table) => [index('preauthorization_case_idx').on(table.caseId)],
);

// Insert-only; the latest effective decision sets the ceiling
// (model/rules.yaml preserve_authorization_decisions).
export const preauthorizationDecision = pgTable(
  'preauthorization_decision',
  {
    preauthorizationDecisionId: uuid('preauthorization_decision_id').primaryKey().defaultRandom(),
    preauthorizationId: uuid('preauthorization_id')
      .notNull()
      .references(() => preauthorization.preauthorizationId),
    sequenceNumber: integer('sequence_number').notNull(),
    outcomeId: uuid('outcome_id').notNull().references(() => preauthorizationOutcomes.id),
    approvedAmount: numeric('approved_amount', { precision: 12, scale: 2 }),
    // The hourly rate the professional was authorized at; review checks
    // time lines against it (model/rules.yaml apply_professional_rates).
    approvedHourlyRate: numeric('approved_hourly_rate', { precision: 12, scale: 2 }),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    decidedByUserAccountId: uuid('decided_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    reason: text('reason'),
  },
  (table) => [uniqueIndex('preauthorization_decision_sequence_uidx').on(table.preauthorizationId, table.sequenceNumber)],
);

// Insert-only like billing_rule_setting; the latest row per code is in
// force. setting_code is one of those in ../billing/reviewSettings.ts.
export const invoiceReviewSetting = pgTable(
  'invoice_review_setting',
  {
    invoiceReviewSettingId: uuid('invoice_review_setting_id').primaryKey().defaultRandom(),
    settingCode: text('setting_code').notNull(),
    parameters: jsonb('parameters'),
    recordedByUserAccountId: uuid('recorded_by_user_account_id')
      .notNull()
      .references(() => userAccount.userAccountId),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('invoice_review_setting_code_idx').on(table.settingCode, table.recordedAt)],
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
// external-user emailed-code sign-in (../auth/signInCode.ts). Stores only a
// keyed hash of the code, never the code itself, so a DB read (backup,
// replica, leaked row) can't be replayed into a session.
export const signInCode = pgTable(
  'sign_in_code',
  {
    signInCodeId: uuid('sign_in_code_id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    // Every try counts, so the right code on the last try still works.
    failedAttempts: integer('failed_attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sign_in_code_email_idx').on(table.email)],
);
