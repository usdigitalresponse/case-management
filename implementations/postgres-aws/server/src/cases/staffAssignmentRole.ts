// The one fixed role for staff case assignments, distinct from "External Submitter"; no qualification check
// (../../docs/api.md "Case assignment, two workflows").
import type { Database } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';

export const STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME = 'Assigned Staff';

export function getStaffAssignmentRoleId(db: Database): Promise<string> {
  return getSeededRoleId(db, STAFF_ASSIGNMENT_ROLE_DISPLAY_NAME, 'case_assignment');
}
