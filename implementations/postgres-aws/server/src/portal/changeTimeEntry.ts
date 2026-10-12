// Edits and deletes a time entry while no live invoice bills it
// (model/rules.yaml validate_activity_and_time_context), by whoever may
// record time for its professional on the case. Each change keeps the
// prior values in audit_event.
import { z } from 'zod';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { auditEvent, timeEntry } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE } from '../billing/invoiceStatusCodes';
import { canRecordTimeFor } from './createTimeEntry';
import type { PortalActor } from './portalActor';

export const updateTimeEntryInputSchema = z.object({
  activityOn: z.iso.date(),
  durationHours: z.coerce.number().positive().max(24),
  description: z.string().min(1),
});

export class TimeEntryNotFoundError extends NotFoundError {
  constructor() {
    super('Time entry not found.');
  }
}

export class TimeEntryInvoicedError extends ConflictError {
  constructor(message: string) {
    super('time_entry_invoiced', message);
  }
}

// The invoice billing the entry; time on a withdrawn one is unbilled again
// (model/rules.yaml validate_payment_request).
export interface TimeEntryBilling {
  invoiceId: string;
  statusCode: string;
}

// Needs `time_entry` in the query. Names are qualified by hand: Drizzle
// leaves columns unqualified in a single-table select.
export const billingOfTimeEntry: SQL<TimeEntryBilling | null> = sql<TimeEntryBilling | null>`(
  select json_build_object('invoiceId', i.invoice_id, 'statusCode', s.code)
  from invoice_line l
  join invoice i on i.invoice_id = l.invoice_id
  join invoice_statuses s on s.id = i.status_id
  where l.source_time_entry_id = time_entry.time_entry_id and s.code <> ${WITHDRAWN_INVOICE_STATUS_CODE}
  limit 1)`;

// Why the entry can't be changed here, shown on the case page and as the error.
export function timeEntryLockedReason(billing: TimeEntryBilling | null): string | null {
  if (billing === null) {
    return null;
  }
  return billing.statusCode === DRAFT_INVOICE_STATUS_CODE
    ? 'This time is on a draft invoice. Change it on that draft, or remove it from the draft to edit or delete it here.'
    : "This time is on an invoice that has been submitted for approval, so it can't be edited or deleted.";
}

async function lockForChange(tx: Transaction, actor: PortalActor, timeEntryId: string) {
  if (!z.uuid().safeParse(timeEntryId).success) {
    throw new TimeEntryNotFoundError();
  }
  // Locking the row also waits out any invoice line being added for it.
  const [row] = await tx.select().from(timeEntry).where(eq(timeEntry.timeEntryId, timeEntryId)).for('update');
  if (!row || !(await canRecordTimeFor(tx, actor, row.professionalId, row.caseId))) {
    throw new TimeEntryNotFoundError();
  }
  const [usage] = await tx
    .select({ billing: billingOfTimeEntry })
    .from(timeEntry)
    .where(eq(timeEntry.timeEntryId, timeEntryId));
  const reason = timeEntryLockedReason(usage?.billing ?? null);
  if (reason) {
    throw new TimeEntryInvoicedError(reason);
  }
  return row;
}

// Also used when a draft's linked line edits its entry.
export async function recordTimeEntryChange(
  tx: Transaction,
  actorUserAccountId: string,
  eventType: 'changed' | 'deleted',
  prior: typeof timeEntry.$inferSelect,
) {
  await tx.insert(auditEvent).values({
    entityType: 'time_entry',
    entityId: prior.timeEntryId,
    eventType,
    actorUserAccountId,
    occurredAt: new Date(),
    priorValues: prior,
  });
}

export async function updateTimeEntry(
  db: Database,
  actor: PortalActor,
  timeEntryId: string,
  rawInput: unknown,
): Promise<{ timeEntryId: string }> {
  const parsed = updateTimeEntryInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  await db.transaction(async (tx) => {
    const prior = await lockForChange(tx, actor, timeEntryId);
    await recordTimeEntryChange(tx, actor.userAccountId, 'changed', prior);
    await tx
      .update(timeEntry)
      .set({
        activityOn: input.activityOn,
        durationHours: input.durationHours.toString(),
        description: input.description,
      })
      .where(eq(timeEntry.timeEntryId, timeEntryId));
  });
  return { timeEntryId };
}

export async function deleteTimeEntry(
  db: Database,
  actor: PortalActor,
  timeEntryId: string,
): Promise<{ timeEntryId: string }> {
  await db.transaction(async (tx) => {
    const prior = await lockForChange(tx, actor, timeEntryId);
    await recordTimeEntryChange(tx, actor.userAccountId, 'deleted', prior);
    await tx.delete(timeEntry).where(eq(timeEntry.timeEntryId, timeEntryId));
  });
  return { timeEntryId };
}
