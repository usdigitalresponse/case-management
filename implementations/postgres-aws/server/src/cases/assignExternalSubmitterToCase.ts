// Assigns an external (magic-link) professional to a case with the fixed
// "External Submitter" role — the counterpart to ./assignStaffToCase.ts.
// No role choice or qualification/workload checks (see
// ../professionals/externalSubmitterRole.ts and ../../MAPPING.md).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, professional, userAccount } from '../db/schema';
import { getStaffAccountRoleId } from '../auth/staffAccountRole';
import { getExternalSubmitterRoleId } from '../professionals/externalSubmitterRole';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { ValidationError } from '../errors';
import { assignProfessionalToCase } from './assignProfessionalToCase';

export const assignExternalSubmitterToCaseInputSchema = z.object({
  professionalId: z.string().uuid(),
});

export class NotExternalProfessionalError extends ValidationError {
  constructor() {
    super({ professionalId: 'professionalId is not an external professional.' });
  }
}

export async function assignExternalSubmitterToCase(
  db: Database,
  actorUserAccountId: string,
  caseId: string,
  rawInput: unknown,
): Promise<typeof caseAssignment.$inferSelect> {
  const parsed = assignExternalSubmitterToCaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { professionalId } = parsed.data;

  const [[professionalRow], staffAccountRoleId, assignmentRoleId] = await Promise.all([
    db
      .select({ systemRoleId: userAccount.systemRoleId })
      .from(professional)
      .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
      .where(eq(professional.professionalId, professionalId)),
    getStaffAccountRoleId(db),
    getExternalSubmitterRoleId(db),
  ]);
  if (!professionalRow) {
    throw new ValidationError({ professionalId: 'professionalId does not exist.' });
  }
  // Staff are assigned through assignStaffToCase, with the staff role.
  if (professionalRow.systemRoleId === staffAccountRoleId) {
    throw new NotExternalProfessionalError();
  }

  return assignProfessionalToCase(db, caseId, professionalId, assignmentRoleId, actorUserAccountId);
}
