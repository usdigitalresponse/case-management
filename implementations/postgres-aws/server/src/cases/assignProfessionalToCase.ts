// Shared by every case-assignment entry point (external submitter,
// staff) — they differ only in how the professionalId and
// assignmentRoleId are resolved, not in how the case_assignment row
// itself is created or how a double-click/retry collision
// (case_assignment_open_unique) is recovered from.
import type { Database } from '../db/client';
import { caseAssignment, CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT } from '../db/schema';
import { uniqueViolationConstraint } from '../db/rowHelpers';

export class AlreadyAssignedError extends Error {
  constructor() {
    super('Already assigned to this case.');
    this.name = 'AlreadyAssignedError';
  }
}

export async function assignProfessionalToCase(
  db: Database,
  caseId: string,
  professionalId: string,
  assignmentRoleId: string,
  actorUserAccountId: string,
): Promise<typeof caseAssignment.$inferSelect> {
  try {
    const [assignment] = await db
      .insert(caseAssignment)
      .values({
        caseId,
        professionalId,
        assignedAt: new Date(),
        assignmentRoleId,
        assignedByUserAccountId: actorUserAccountId,
      })
      .returning();
    if (!assignment) {
      throw new Error('Expected case_assignment insert to return a row.');
    }
    return assignment;
  } catch (error) {
    if (uniqueViolationConstraint(error) === CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT) {
      throw new AlreadyAssignedError();
    }
    throw error;
  }
}
