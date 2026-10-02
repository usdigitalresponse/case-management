// Time logging for the external portal (and, in principle, any
// professional - see ../routes/portal.ts). Reference existence for
// activityTypeId relies on the FK constraint rather than a friendly
// pre-check (unlike ../intake/createCase.ts) - acceptable with a single
// seeded activity type for now; revisit if the UI needs field-level
// errors here.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { activityTypes, timeEntry } from '../db/schema';
import { hasOpenAssignment, NotAssignedToCaseError } from './caseAssignmentAuthorization';

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
});

export type CreateTimeEntryInput = z.infer<typeof createTimeEntryInputSchema>;

export interface CreateTimeEntryActor {
  professionalId: string;
}

export interface CreateTimeEntryResult {
  timeEntryId: string;
}

export class CreateTimeEntryValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Invalid time entry');
    this.name = 'CreateTimeEntryValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class CreateTimeEntryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateTimeEntryConfigurationError';
  }
}

export async function createTimeEntry(
  db: Database,
  actor: CreateTimeEntryActor,
  rawInput: unknown,
): Promise<CreateTimeEntryResult> {
  const parsed = createTimeEntryInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CreateTimeEntryValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;

  if (!(await hasOpenAssignment(db, actor.professionalId, input.caseId))) {
    throw new NotAssignedToCaseError();
  }

  const [defaultActivityType] = await db.select().from(activityTypes).where(eq(activityTypes.code, DEFAULT_ACTIVITY_TYPE_CODE));
  if (!defaultActivityType) {
    throw new CreateTimeEntryConfigurationError(
      `Missing required seeded activity_types row with code "${DEFAULT_ACTIVITY_TYPE_CODE}".`,
    );
  }

  const inserted = firstRow(
    await db
      .insert(timeEntry)
      .values({
        caseId: input.caseId,
        professionalId: actor.professionalId,
        activityTypeId: defaultActivityType.id,
        activityOn: input.activityOn,
        durationHours: input.durationHours.toString(),
        description: input.description,
      })
      .returning(),
  );
  return { timeEntryId: inserted.timeEntryId };
}
