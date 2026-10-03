// Shared authorization check for the external portal: is this
// professional currently (open-endedly) assigned to this case? Used by
// both ./createTimeEntry.ts and ./createInvoice.ts, which otherwise had
// no reason to duplicate the same query.
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment } from '../db/schema';
import { ForbiddenError } from '../errors';

export async function hasOpenAssignment(db: Database, professionalId: string, caseId: string): Promise<boolean> {
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

// Distinct from a validation error: the request is well-formed, but the
// caller has no open case_assignment for this case — the actual
// authorization check (see model/schema.yaml case_assignment and
// ../../MAPPING.md "Case assignment, scoped to external submitters").
export class NotAssignedToCaseError extends ForbiddenError {
  constructor() {
    super('not_assigned', 'Not assigned to this case.');
  }
}
