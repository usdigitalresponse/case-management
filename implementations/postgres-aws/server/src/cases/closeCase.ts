// Closing a case — the counterpart to ../intake/createCase.ts's opening
// event. model/rules.yaml's preserve_case_lifecycle rule for closing:
// requires an open state and a reason; ends every assignment active at
// the closure effective timestamp (ended_at/ended_by/end_reason); commits
// the closing event, assignment endings and status projection (case's
// status_id/closed_on) atomically. The case row is locked FOR UPDATE
// first, which serializes concurrent closes and blocks
// ./assignProfessionalToCase.ts (which share-locks it) from adding an
// assignment mid-close. Corrections/reopening are not implemented — a
// case closed here stays closed.
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { caseTable, caseAssignment, caseLifecycleEvent, caseLifecycleEventTypes, caseStatuses } from '../db/schema';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';
import { CaseAlreadyClosedError, CaseNotFoundError } from './errors';

// Server-selected synthetic closing event type/status, the same
// simplification as ../intake/createCase.ts's OPENING_EVENT_TYPE_CODE —
// case_lifecycle_event_types/case_statuses are organization-configurable
// reference data in the canonical model, not fixed app constants, so
// these codes exist only in ../db/fixtures.ts (test/dev), not
// ../db/ensureReferenceData.ts; see MAPPING.md.
const CLOSING_EVENT_TYPE_CODE = 'sample_closed';
const CLOSED_CASE_STATUS_CODE = 'sample_closed';

export const closeCaseInputSchema = z.object({
  // model/rules.yaml: closing requires a reason.
  reasonDetail: z.string().trim().min(1),
  effectiveAt: z.coerce.date().optional(),
});

export type CloseCaseInput = z.infer<typeof closeCaseInputSchema>;

export class CloseCaseValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Invalid case closure');
    this.name = 'CloseCaseValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class CloseCaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloseCaseConfigurationError';
  }
}

export interface CloseCaseResult {
  caseId: string;
  caseLifecycleEventId: string;
  closedOn: string;
}

export async function closeCase(
  db: Database,
  actorUserAccountId: string,
  caseId: string,
  rawInput: unknown,
): Promise<CloseCaseResult> {
  const parsed = closeCaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CloseCaseValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  const effectiveAt = input.effectiveAt ?? new Date();

  const [[closedStatus], [closingEventType]] = await Promise.all([
    db.select().from(caseStatuses).where(eq(caseStatuses.code, CLOSED_CASE_STATUS_CODE)),
    db.select().from(caseLifecycleEventTypes).where(eq(caseLifecycleEventTypes.code, CLOSING_EVENT_TYPE_CODE)),
  ]);
  if (!closedStatus) {
    throw new CloseCaseConfigurationError(`Missing required seeded case_statuses row with code "${CLOSED_CASE_STATUS_CODE}".`);
  }
  if (!closingEventType) {
    throw new CloseCaseConfigurationError(
      `Missing required seeded case_lifecycle_event_types row with code "${CLOSING_EVENT_TYPE_CODE}".`,
    );
  }
  const closedOn = calendarDateInReportingTimeZone(effectiveAt);

  return db.transaction(async (tx) => {
    const [caseRow] = await tx
      .select({ closedOn: caseTable.closedOn })
      .from(caseTable)
      .where(eq(caseTable.caseId, caseId))
      .for('update');
    if (!caseRow) {
      throw new CaseNotFoundError();
    }
    if (caseRow.closedOn) {
      throw new CaseAlreadyClosedError();
    }

    const [latestEvent] = await tx
      .select({ sequenceNumber: caseLifecycleEvent.sequenceNumber })
      .from(caseLifecycleEvent)
      .where(eq(caseLifecycleEvent.caseId, caseId))
      .orderBy(desc(caseLifecycleEvent.sequenceNumber))
      .limit(1);
    const nextSequenceNumber = (latestEvent?.sequenceNumber ?? 0) + 1;

    const recordedAt = new Date();
    const event = firstRow(
      await tx
        .insert(caseLifecycleEvent)
        .values({
          caseId,
          sequenceNumber: nextSequenceNumber,
          eventTypeId: closingEventType.id,
          resultingStatusId: closedStatus.id,
          effectiveAt,
          recordedAt,
          actorUserAccountId,
          reasonDetail: input.reasonDetail,
        })
        .returning(),
    );

    await tx.update(caseTable).set({ statusId: closedStatus.id, closedOn }).where(eq(caseTable.caseId, caseId));

    await tx
      .update(caseAssignment)
      .set({ endedAt: effectiveAt, endedByUserAccountId: actorUserAccountId, endReason: 'Case closed' })
      .where(and(eq(caseAssignment.caseId, caseId), isNull(caseAssignment.endedAt)));

    return { caseId, caseLifecycleEventId: event.caseLifecycleEventId, closedOn };
  });
}
