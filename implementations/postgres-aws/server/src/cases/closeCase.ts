// Closing a case (model/rules.yaml preserve_case_lifecycle): an open case and a reason; the closing event,
// assignment endings and status commit together, under a FOR UPDATE lock that keeps assignments out. A cleanup,
// since the external system holds the real status: it waits until no invoice is in review or decided and not
// completed. Reopening never brings ended assignments back.
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

// Synthetic codes, as createCase's opening event: the model makes these configurable, so they exist only in
// ../db/fixtures.ts (docs/api.md "Closing a case").
export const CLOSING_EVENT_TYPE_CODE = 'sample_closed';
export const CLOSED_CASE_STATUS_CODE = 'sample_closed';
export const REOPENING_EVENT_TYPE_CODE = 'sample_reopened';
export const OPEN_CASE_STATUS_CODE = 'sample_open';

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

export async function nextLifecycleSequence(tx: Transaction, caseId: string): Promise<number> {
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
