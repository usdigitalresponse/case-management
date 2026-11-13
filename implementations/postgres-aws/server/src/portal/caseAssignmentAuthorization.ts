// Whether a professional has an open assignment to a case.
import { and, eq, isNull } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseAssignment } from '../db/schema';
import { ForbiddenError } from '../errors';

export async function hasOpenAssignment(db: DatabaseOrTransaction, professionalId: string, caseId: string): Promise<boolean> {
  const [assignment] = await db
    .select({ caseAssignmentId: caseAssignment.caseAssignmentId })
    .from(caseAssignment)
    .where(
      and(
        eq(caseAssignment.caseId, caseId),
        eq(caseAssignment.professionalId, professionalId),
        isNull(caseAssignment.endedAt),
      ),
    );
  return Boolean(assignment);
}

// A well-formed request from someone with no open assignment to the case.
export class NotAssignedToCaseError extends ForbiddenError {
  constructor() {
    super('not_assigned', 'Not assigned to this case.');
  }
}
