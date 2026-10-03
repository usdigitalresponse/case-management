// The case_assignment-context role used when a full user assigns an
// external (magic-link) professional to a case.
import type { Database } from '../db/client';
import { getSeededRoleId } from '../db/seededRole';

export const EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME = 'External Submitter';

export function getExternalSubmitterRoleId(db: Database): Promise<string> {
  return getSeededRoleId(db, EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME, 'case_assignment');
}
