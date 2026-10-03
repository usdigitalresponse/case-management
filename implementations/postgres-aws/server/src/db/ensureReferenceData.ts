// Idempotent seeding of the reference/config rows the app needs to
// function at all (activity_types, invoice statuses/line types/approval
// step types/outcomes, and the fixed staff and assignment roles). Safe to
// run in every environment, including production, and is: ./migrate.ts
// calls it, and ./fixtures.ts calls it after its reset, so there is one
// definition of these rows.
import type { Database } from './client';
import {
  activityTypes,
  invoiceLineTypes,
  invoiceStatuses,
  invoiceApprovalStepTypes,
  invoiceApprovalOutcomes,
  role,
} from './schema';
import { EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME } from '../professionals/externalSubmitterRole';
import { STAFF_ACCOUNT_ROLE_DISPLAY_NAME } from '../auth/staffAccountRole';
import { STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME } from '../cases/staffAssignmentRole';

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
        { code: 'approved', displayName: 'Approved' },
        { code: 'rejected', displayName: 'Rejected' },
      ])
      .onConflictDoNothing({ target: invoiceStatuses.code }),
    db
      .insert(invoiceLineTypes)
      .values({ code: 'service', displayName: 'Service' })
      .onConflictDoNothing({ target: invoiceLineTypes.code }),
    db
      .insert(invoiceApprovalStepTypes)
      .values({ code: 'line_review', displayName: 'Line Review' })
      .onConflictDoNothing({ target: invoiceApprovalStepTypes.code }),
    db
      .insert(invoiceApprovalOutcomes)
      .values([
        { code: 'approved', displayName: 'Approved' },
        { code: 'rejected', displayName: 'Rejected' },
      ])
      .onConflictDoNothing({ target: invoiceApprovalOutcomes.code }),
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
  ]);
}
