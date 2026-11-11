// Closing a case — the counterpart to ../intake/createCase.ts's opening
// event. model/rules.yaml's preserve_case_lifecycle rule for closing:
// requires an open state and a reason; ends every assignment active at
// the closure effective timestamp (ended_at/ended_by/end_reason); commits
// the closing event, assignment endings and status projection (case's
// status_id/closed_on) atomically. The case row is locked FOR UPDATE
// first, which serializes concurrent closes and blocks
// ./assignProfessionalToCase.ts (which share-locks it) from adding an
// assignment mid-close. The case's real status lives in the external case
// system, so closing here is a cleanup: it waits until no invoice is in
// review or decided and not marked completed. Reopening (matching a later
// invoice to the case does it) doesn't bring the ended assignments back.
import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { caseTable, caseAssignment, caseLifecycleEvent, caseLifecycleEventTypes, caseStatuses, invoice, invoiceStatuses } from '../db/schema';
import { DECIDED_INVOICE_STATUS_CODES, IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { completionMarkedAt } from '../billing/invoiceEvents';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';
import { CaseAlreadyClosedError, CaseInvoicesUnfinishedError, CaseNotClosedError, CaseNotFoundError } from './errors';

// Server-selected synthetic closing event type/status, the same
// simplification as ../intake/createCase.ts's OPENING_EVENT_TYPE_CODE —
// case_lifecycle_event_types/case_statuses are organization-configurable
// reference data in the canonical model, not fixed app constants, so
// these codes exist only in ../db/fixtures.ts (test/dev), not
// ../db/ensureReferenceData.ts; see docs/api.md "Closing a case".
const CLOSING_EVENT_TYPE_CODE = 'sample_closed';
const CLOSED_CASE_STATUS_CODE = 'sample_closed';
const REOPENING_EVENT_TYPE_CODE = 'sample_reopened';
const OPEN_CASE_STATUS_CODE = 'sample_open';

export const closeCaseInputSchema = z.object({
  // model/rules.yaml: closing requires a reason.
  reasonDetail: z.string().trim().min(1),
});

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
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  // Always now: a backdated close could end assignments before they began
  // or set closed_on before the case opened.
  const effectiveAt = new Date();

  const [closedStatusId, closingEventTypeId] = await Promise.all([
    getReferenceId(db, caseStatuses, CLOSED_CASE_STATUS_CODE),
    getReferenceId(db, caseLifecycleEventTypes, CLOSING_EVENT_TYPE_CODE),
  ]);
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
    const unfinished = await unfinishedInvoices(tx, caseId);
    if (unfinished.waiting > 0 || unfinished.notCompleted > 0) {
      throw new CaseInvoicesUnfinishedError(unfinished.waiting, unfinished.notCompleted);
    }
    const nextSequenceNumber = await nextLifecycleSequence(tx, caseId);

    const event = firstRow(
      await tx
        .insert(caseLifecycleEvent)
        .values({
          caseId,
          sequenceNumber: nextSequenceNumber,
          eventTypeId: closingEventTypeId,
          resultingStatusId: closedStatusId,
          effectiveAt,
          recordedAt: effectiveAt,
          actorUserAccountId,
          reasonDetail: input.reasonDetail,
        })
        .returning(),
    );

    await tx.update(caseTable).set({ statusId: closedStatusId, closedOn }).where(eq(caseTable.caseId, caseId));

    await tx
      .update(caseAssignment)
      .set({ endedAt: effectiveAt, endedByUserAccountId: actorUserAccountId, endReason: 'Case closed' })
      .where(and(eq(caseAssignment.caseId, caseId), isNull(caseAssignment.endedAt)));

    return { caseId, caseLifecycleEventId: event.caseLifecycleEventId, closedOn };
  });
}

// What stops a case closing here: invoices in review, and decided ones not
// marked completed.
export async function unfinishedInvoices(db: DatabaseOrTransaction, caseId: string) {
  const rows = await db
    .select({ statusCode: invoiceStatuses.code, completedAt: completionMarkedAt })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(and(eq(invoice.caseId, caseId), inArray(invoiceStatuses.code, [...IN_REVIEW_INVOICE_STATUS_CODES, ...DECIDED_INVOICE_STATUS_CODES])));
  return {
    waiting: rows.filter((row) => IN_REVIEW_INVOICE_STATUS_CODES.includes(row.statusCode)).length,
    notCompleted: rows.filter((row) => DECIDED_INVOICE_STATUS_CODES.includes(row.statusCode) && !row.completedAt).length,
  };
}

async function nextLifecycleSequence(tx: Transaction, caseId: string): Promise<number> {
  const [latestEvent] = await tx
    .select({ sequenceNumber: caseLifecycleEvent.sequenceNumber })
    .from(caseLifecycleEvent)
    .where(eq(caseLifecycleEvent.caseId, caseId))
    .orderBy(desc(caseLifecycleEvent.sequenceNumber))
    .limit(1);
  return (latestEvent?.sequenceNumber ?? 0) + 1;
}

// model/rules.yaml preserve_case_lifecycle: reopening needs a closed case and
// a reason. Ended assignments stay ended.
export async function reopenCase(
  db: Database,
  actorUserAccountId: string,
  caseId: string,
  rawInput: unknown,
): Promise<{ caseId: string; caseLifecycleEventId: string }> {
  const parsed = closeCaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const effectiveAt = new Date();
  const [openStatusId, reopeningEventTypeId] = await Promise.all([
    getReferenceId(db, caseStatuses, OPEN_CASE_STATUS_CODE),
    getReferenceId(db, caseLifecycleEventTypes, REOPENING_EVENT_TYPE_CODE),
  ]);
  return db.transaction(async (tx) => {
    const [caseRow] = await tx.select({ closedOn: caseTable.closedOn }).from(caseTable).where(eq(caseTable.caseId, caseId)).for('update');
    if (!caseRow) {
      throw new CaseNotFoundError();
    }
    if (!caseRow.closedOn) {
      throw new CaseNotClosedError();
    }
    const event = firstRow(
      await tx
        .insert(caseLifecycleEvent)
        .values({
          caseId,
          sequenceNumber: await nextLifecycleSequence(tx, caseId),
          eventTypeId: reopeningEventTypeId,
          resultingStatusId: openStatusId,
          effectiveAt,
          recordedAt: effectiveAt,
          actorUserAccountId,
          reasonDetail: parsed.data.reasonDetail,
        })
        .returning(),
    );
    await tx.update(caseTable).set({ statusId: openStatusId, closedOn: null }).where(eq(caseTable.caseId, caseId));
    return { caseId, caseLifecycleEventId: event.caseLifecycleEventId };
  });
}
