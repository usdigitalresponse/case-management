// The case_assignment-context role used when a full user assigns another
// staff member to a case — distinct from "External Submitter"
// (../professionals/externalSubmitterRole.ts) so the two kinds of
// assignment stay distinguishable in case_assignment rows. No
// qualification/role-choice is implemented (model/rules.yaml
// require_qualification_for_assignment, outcome: configurable; see
// ../../MAPPING.md) — every staff assignment uses this one fixed role,
// the same simplification already made for external assignments.
import type { Database } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';

export const STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME = 'Assigned Staff';

export function getStaffAssignmentRoleId(db: Database): Promise<string> {
  return getSeededRoleId(db, STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME, 'case_assignment');
}
