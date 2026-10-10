// Lets office staff submit invoices for the office's professionals
// (model/rules.yaml authorize_delegated_submission).
import type { DatabaseOrTransaction } from '../db/client';
import { getSeededRoleId } from '../db/referenceLookups';

export const DELEGATE_AFFILIATION_ROLE_DISPLAY_NAME = 'Billing Delegate';

export function getDelegateAffiliationRoleId(db: DatabaseOrTransaction): Promise<string> {
  return getSeededRoleId(db, DELEGATE_AFFILIATION_ROLE_DISPLAY_NAME, 'person_affiliation');
}
