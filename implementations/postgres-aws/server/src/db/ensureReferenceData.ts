// Idempotent seeding of the small reference/config rows the external
// portal needs to function at all (activity_types, invoice_statuses,
// invoice_line_types, and the "External Submitter" case_assignment
// role) — unlike resetAndSeedBaselineFixtures (../db/fixtures.ts,
// destructive, test/dev-only), this is safe to run in every environment,
// including production, and is meant to be. Previously only the role got
// a lazy-create-on-first-use workaround (see git history of
// ../professionals/externalSubmitterRole.ts) because production never
// runs the fixture reset; the other three rows had no such workaround and
// would 500 on first use in any real deployment. Call this once from
// ./migrate.ts instead, so every environment provisions these rows the
// same way and none of the portal code needs a fallback for "what if this
// reference row doesn't exist yet."
import type { Database } from './client';
import { activityTypes, invoiceLineTypes, invoiceStatuses, role } from './schema';
import { EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME } from '../professionals/externalSubmitterRole';

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
      ])
      .onConflictDoNothing({ target: invoiceStatuses.code }),
    db
      .insert(invoiceLineTypes)
      .values({ code: 'service', displayName: 'Service' })
      .onConflictDoNothing({ target: invoiceLineTypes.code }),
    db
      .insert(role)
      .values({ displayName: EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME, roleContext: 'case_assignment', active: true })
      .onConflictDoNothing({ target: [role.displayName, role.roleContext] }),
  ]);
}
