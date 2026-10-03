// Internal-staff case assignment — the counterpart to
// ./assignExternalSubmitterToCase.ts. Staff has no professional profile
// until their first assignment (unlike a vendor's, bootstrapped at
// magic-link login; see ../professionals/ensureProfessional.ts), so one is
// created lazily here.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, userAccount } from '../db/schema';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { getStaffAccountRoleId } from '../auth/staffAccountRole';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { ValidationError } from '../errors';
import { getStaffAssignmentRoleId } from './staffAssignmentRole';
import { assignProfessionalToCase } from './assignProfessionalToCase';

export const assignStaffToCaseInputSchema = z.object({
  userAccountId: z.string().uuid(),
});

export class NotStaffAccountError extends ValidationError {
  constructor() {
    super({ userAccountId: 'userAccountId is not a staff account.' });
  }
}

export async function assignStaffToCase(
  db: Database,
  actorUserAccountId: string,
  caseId: string,
  rawInput: unknown,
): Promise<typeof caseAssignment.$inferSelect> {
  const parsed = assignStaffToCaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { userAccountId } = parsed.data;

  const [[staffAccountRow], staffAccountRoleId] = await Promise.all([
    db
      .select({ displayName: userAccount.displayName, systemRoleId: userAccount.systemRoleId })
      .from(userAccount)
      .where(eq(userAccount.userAccountId, userAccountId)),
    getStaffAccountRoleId(db),
  ]);
  if (!staffAccountRow || staffAccountRow.systemRoleId !== staffAccountRoleId) {
    throw new NotStaffAccountError();
  }

  const [professionalId, assignmentRoleId] = await Promise.all([
    ensureProfessionalForUserAccount(db, userAccountId, staffAccountRow.displayName),
    getStaffAssignmentRoleId(db),
  ]);
  return assignProfessionalToCase(db, caseId, professionalId, assignmentRoleId, actorUserAccountId);
}
