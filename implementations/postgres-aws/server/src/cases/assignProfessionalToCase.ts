// Shared by every case-assignment entry point (external submitter,
// staff) — they differ only in how the professionalId and
// assignmentRoleId are resolved, not in how the case_assignment row
// itself is created or how a double-click/retry collision
// (case_assignment_open_unique) is recovered from.
//
// model/rules.yaml: new assignments must begin while the case is open.
// The case row is share-locked for the insert, and ./closeCase.ts
// update-locks it before ending open assignments, so an assignment can't
// slip in alongside a concurrent close.
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, caseTable, CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT } from '../db/schema';
import { firstRow, uniqueViolationConstraint } from '../db/rowHelpers';
import { CaseAlreadyClosedError, CaseNotFoundError } from './errors';

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
    return await db.transaction(async (tx) => {
      const [caseRow] = await tx
        .select({ closedOn: caseTable.closedOn })
        .from(caseTable)
        .where(eq(caseTable.caseId, caseId))
        .for('share');
      if (!caseRow) {
        throw new CaseNotFoundError();
      }
      if (caseRow.closedOn) {
        throw new CaseAlreadyClosedError();
      }

      return firstRow(
        await tx
          .insert(caseAssignment)
          .values({
            caseId,
            professionalId,
            assignedAt: new Date(),
            assignmentRoleId,
            assignedByUserAccountId: actorUserAccountId,
          })
          .returning(),
      );
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) === CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT) {
      throw new AlreadyAssignedError();
    }
    throw error;
  }
}
