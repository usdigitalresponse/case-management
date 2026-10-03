// Internal-staff case assignment — the counterpart to the external
// submitter flow (../routes/cases.ts POST /:id/external-assignments).
// Extracted from the route handler so "is this actually a staff account"
// and the lazy professional bootstrap are unit-testable without an HTTP
// harness (same pattern as ../portal/createTimeEntry.ts).
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, caseTable, userAccount } from '../db/schema';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { getStaffAccountRoleId } from '../auth/staffAccountRole';
import { getStaffAssignmentRoleId } from './staffAssignmentRole';
import { assignProfessionalToCase } from './assignProfessionalToCase';
import { ValidationError } from '../errors';
import { CaseNotFoundError } from './errors';

export class NotStaffAccountError extends ValidationError {
  constructor() {
    super({ userAccountId: 'userAccountId is not a staff account.' });
  }
}

export interface AssignStaffToCaseInput {
  caseId: string;
  userAccountId: string;
}

export async function assignStaffToCase(
  db: Database,
  actorUserAccountId: string,
  input: AssignStaffToCaseInput,
): Promise<typeof caseAssignment.$inferSelect> {
  const [[caseRow], [staffAccountRow], staffAccountRoleId] = await Promise.all([
    db.select({ caseId: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, input.caseId)),
    db
      .select({
        userAccountId: userAccount.userAccountId,
        displayName: userAccount.displayName,
        systemRoleId: userAccount.systemRoleId,
      })
      .from(userAccount)
      .where(eq(userAccount.userAccountId, input.userAccountId)),
    getStaffAccountRoleId(db),
  ]);
  if (!caseRow) {
    throw new CaseNotFoundError();
  }
  if (!staffAccountRow || staffAccountRow.systemRoleId !== staffAccountRoleId) {
    throw new NotStaffAccountError();
  }

  const professionalId = await ensureProfessionalForUserAccount(db, input.userAccountId, staffAccountRow.displayName);
  const assignmentRoleId = await getStaffAssignmentRoleId(db);
  return assignProfessionalToCase(db, input.caseId, professionalId, assignmentRoleId, actorUserAccountId);
}
