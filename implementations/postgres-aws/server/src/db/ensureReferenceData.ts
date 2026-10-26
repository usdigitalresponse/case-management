// Idempotent seeding of the reference/config rows the app needs to
// function at all (activity_types, the mileage expense type, invoice statuses/line types/approval
// step types/outcomes/event types, invoice import formats/statuses, and the
// fixed staff, administrator, assignment and delegate roles). Safe to run in every
// environment, including production, and is: ./migrate.ts calls it, and
// ./fixtures.ts calls it after its reset, so there is one definition of
// these rows.
import type { Database } from './client';
import {
  activityTypes,
  expenseTypes,
  invoiceLineTypes,
  invoiceStatuses,
  invoiceApprovalStepTypes,
  invoiceApprovalOutcomes,
  invoiceDecisionReasons,
  invoiceEventTypes,
  invoiceImportFormats,
  invoiceImportStatuses,
  invoiceReceiptChannels,
  preauthorizationOutcomes,
  preauthorizationStatuses,
  role,
} from './schema';
import { EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME } from '../professionals/externalSubmitterRole';
import {
  ADMIN_ACCOUNT_ROLE_DISPLAY_NAME,
  BILLING_REVIEWER_ROLE_DISPLAY_NAME,
  SIGN_OFF_APPROVER_ROLE_DISPLAY_NAME,
  STAFF_ACCOUNT_ROLE_DISPLAY_NAME,
} from '../auth/staffAccountRole';
import { INVOICE_DECISION_REASONS } from '../billing/decisionReasons';
import { STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME } from '../cases/staffAssignmentRole';
import { DELEGATE_AFFILIATION_ROLE_DISPLAY_NAME } from '../professionals/delegateRole';

export async function ensureReferenceData(db: Database): Promise<void> {
  await Promise.all([
    db
      .insert(activityTypes)
      .values({ code: 'legal_services', displayName: 'Legal Services' })
      .onConflictDoNothing({ target: activityTypes.code }),
    db
      .insert(invoiceStatuses)
      .values([
        { code: 'draft', displayName: 'Draft' },
        { code: 'submitted', displayName: 'Submitted' },
        { code: 'under_review', displayName: 'Being reviewed' },
        { code: 'awaiting_sign_off', displayName: 'Waiting for sign-off' },
        { code: 'approved', displayName: 'Approved' },
        { code: 'rejected', displayName: 'Rejected' },
        { code: 'withdrawn', displayName: 'Withdrawn' },
      ])
      .onConflictDoNothing({ target: invoiceStatuses.code }),
    db
      .insert(invoiceDecisionReasons)
      .values(INVOICE_DECISION_REASONS)
      .onConflictDoNothing({ target: invoiceDecisionReasons.code }),
    db
      .insert(invoiceReceiptChannels)
      .values([
        { code: 'email', displayName: 'Email' },
        { code: 'other_tool', displayName: 'Another tool or system' },
        { code: 'mail', displayName: 'Mail or in person' },
      ])
      .onConflictDoNothing({ target: invoiceReceiptChannels.code }),
    db
      .insert(preauthorizationStatuses)
      .values([
        { code: 'pending', displayName: 'Pending' },
        { code: 'approved', displayName: 'Approved' },
        { code: 'denied', displayName: 'Denied' },
      ])
      .onConflictDoNothing({ target: preauthorizationStatuses.code }),
    db
      .insert(preauthorizationOutcomes)
      .values([
        { code: 'approved', displayName: 'Approved' },
        { code: 'revised', displayName: 'Revised' },
        { code: 'denied', displayName: 'Denied' },
      ])
      .onConflictDoNothing({ target: preauthorizationOutcomes.code }),
    db
      .insert(invoiceEventTypes)
      .values([
        { code: 'draft_created', displayName: 'Draft created' },
        { code: 'submitted', displayName: 'Submitted' },
        { code: 'recalled', displayName: 'Recalled' },
        { code: 'withdrawn', displayName: 'Withdrawn' },
        { code: 'approved', displayName: 'Approved' },
        { code: 'rejected', displayName: 'Rejected' },
        { code: 'review_started', displayName: 'Review started' },
        { code: 'review_finished', displayName: 'Review finished' },
        { code: 'review_reopened', displayName: 'Review reopened' },
        { code: 'signed_off', displayName: 'Signed off' },
        { code: 'sent_back', displayName: 'Sent back to the reviewer' },
      ])
      .onConflictDoNothing({ target: invoiceEventTypes.code }),
    db
      .insert(invoiceLineTypes)
      .values([
        { code: 'service', displayName: 'Service' },
        { code: 'time', displayName: 'Time' },
        { code: 'expense', displayName: 'Expense' },
      ])
      .onConflictDoNothing({ target: invoiceLineTypes.code }),
    // Mileage is priced from mileage rates and its distance checked.
    db
      .insert(expenseTypes)
      .values({ code: 'mileage', displayName: 'Mileage' })
      .onConflictDoNothing({ target: expenseTypes.code }),
    db
      .insert(invoiceImportFormats)
      .values([
        { code: 'ledes_1998b', displayName: 'LEDES 1998B' },
        { code: 'spreadsheet', displayName: 'Spreadsheet' },
        { code: 'document', displayName: 'Document' },
      ])
      .onConflictDoNothing({ target: invoiceImportFormats.code }),
    db
      .insert(invoiceImportStatuses)
      .values([
        { code: 'received', displayName: 'Received' },
        { code: 'extracted', displayName: 'Extracted' },
        { code: 'failed', displayName: 'Failed' },
        { code: 'confirmed', displayName: 'Confirmed' },
        { code: 'discarded', displayName: 'Discarded' },
      ])
      .onConflictDoNothing({ target: invoiceImportStatuses.code }),
    db
      .insert(invoiceApprovalStepTypes)
      .values([
        { code: 'line_review', displayName: 'Line Review' },
        { code: 'sign_off', displayName: 'Sign-off' },
      ])
      .onConflictDoNothing({ target: invoiceApprovalStepTypes.code }),
    db
      .insert(invoiceApprovalOutcomes)
      .values([
        { code: 'approved', displayName: 'Approved' },
        { code: 'rejected', displayName: 'Rejected' },
        { code: 'changes_requested', displayName: 'Sent back' },
      ])
      .onConflictDoNothing({ target: invoiceApprovalOutcomes.code }),
    ...[BILLING_REVIEWER_ROLE_DISPLAY_NAME, SIGN_OFF_APPROVER_ROLE_DISPLAY_NAME].map((displayName) =>
      db
        .insert(role)
        .values({ displayName, roleContext: 'user_account', active: true })
        .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
    ),
    db
      .insert(role)
      .values({ displayName: EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME, roleContext: 'case_assignment', active: true })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
    db
      .insert(role)
      .values({ displayName: STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME, roleContext: 'case_assignment', active: true })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
    db
      .insert(role)
      .values({ displayName: STAFF_ACCOUNT_ROLE_DISPLAY_NAME, roleContext: 'user_account', active: true })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
    db
      .insert(role)
      .values({ displayName: ADMIN_ACCOUNT_ROLE_DISPLAY_NAME, roleContext: 'user_account', active: true })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
    db
      .insert(role)
      .values({ displayName: DELEGATE_AFFILIATION_ROLE_DISPLAY_NAME, roleContext: 'person_affiliation', active: true })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
  ]);
}
