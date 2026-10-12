// Time logging for the external portal: a professional records their own
// time, or a delegate records it for a professional they act for
// (model/rules.yaml authorize_delegated_submission), and the entry keeps who
// recorded it. Reference existence for
// activityTypeId relies on the FK constraint rather than a friendly
// pre-check (unlike ../intake/createCase.ts) - acceptable with a single
// seeded activity type for now; revisit if the UI needs field-level
// errors here.
import { z } from 'zod';
import type { Database, DatabaseOrTransaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { activityTypes, timeEntry } from '../db/schema';
import { hasOpenAssignment, NotAssignedToCaseError } from './caseAssignmentAuthorization';
import { representedProfessionalIds, type PortalActor } from './portalActor';

// Server-selected synthetic row, the same pattern as
// ../intake/createCase.ts's OPENING_EVENT_TYPE_CODE: a single seeded
// activity type exists today (see ../db/fixtures.ts), so the client
// doesn't need to pick one.
const DEFAULT_ACTIVITY_TYPE_CODE = 'legal_services';

export const createTimeEntryInputSchema = z.object({
  caseId: z.string().uuid(),
  activityOn: z.iso.date(),
  durationHours: z.coerce.number().positive().max(24),
  description: z.string().min(1),
  // Whose work it is; defaults to your own.
  professionalId: z.uuid().optional(),
});

export type CreateTimeEntryInput = z.infer<typeof createTimeEntryInputSchema>;

export interface CreateTimeEntryResult {
  timeEntryId: string;
}

// Your own time on a case you're assigned to, or as a delegate, time of a
// professional you act for who is assigned to it.
export async function canRecordTimeFor(
  db: DatabaseOrTransaction,
  actor: PortalActor,
  professionalId: string,
  caseId: string,
): Promise<boolean> {
  return professionalId === actor.professionalId
    ? hasOpenAssignment(db, professionalId, caseId)
    : (await representedProfessionalIds(db, actor.userAccountId, caseId)).includes(professionalId);
}

export async function createTimeEntry(
  db: Database,
  actor: PortalActor,
  rawInput: unknown,
): Promise<CreateTimeEntryResult> {
  const parsed = createTimeEntryInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;

  const professionalId = input.professionalId ?? actor.professionalId;
  if (!professionalId) {
    throw new ValidationError({ professionalId: 'Choose whose time this is.' });
  }
  if (!(await canRecordTimeFor(db, actor, professionalId, input.caseId))) {
    throw new NotAssignedToCaseError();
  }

  const activityTypeId = await getReferenceId(db, activityTypes, DEFAULT_ACTIVITY_TYPE_CODE);

  const inserted = firstRow(
    await db
      .insert(timeEntry)
      .values({
        caseId: input.caseId,
        professionalId,
        activityTypeId,
        activityOn: input.activityOn,
        durationHours: input.durationHours.toString(),
        description: input.description,
        recordedByUserAccountId: actor.userAccountId,
      })
      .returning(),
  );
  return { timeEntryId: inserted.timeEntryId };
}
