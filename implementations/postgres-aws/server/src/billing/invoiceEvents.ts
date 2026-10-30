// Appends to an invoice's immutable history (model/schema.yaml invoice_event).
// Callers hold the invoice row lock so sequence numbers can't collide.
import { eq, max, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import { invoice, invoiceEvent, invoiceEventTypes } from '../db/schema';

export const RETURNED_TO_SUBMITTER_EVENT_CODE = 'returned_to_submitter';

// Why staff sent a draft back, while that's the latest thing to happen to it.
export const returnedReason = sql<string | null>`(
  select case when ${invoiceEventTypes.code} = ${RETURNED_TO_SUBMITTER_EVENT_CODE} then ${invoiceEvent.reason} end
  from ${invoiceEvent} join ${invoiceEventTypes} on ${invoiceEventTypes.id} = ${invoiceEvent.eventTypeId}
  where ${invoiceEvent.invoiceId} = ${invoice.invoiceId}
  order by ${invoiceEvent.sequenceNumber} desc limit 1
)`;

export async function recordInvoiceEvent(
  tx: Transaction,
  event: {
    invoiceId: string;
    eventTypeCode: string;
    statusId: string;
    chainId?: string;
  } & ({ actorUserAccountId: string; reason?: string } | { actorUserAccountId: null; reason: string }),
): Promise<void> {
  const eventTypeId = await getReferenceId(tx, invoiceEventTypes, event.eventTypeCode);
  const [current] = await tx
    .select({ last: max(invoiceEvent.sequenceNumber) })
    .from(invoiceEvent)
    .where(eq(invoiceEvent.invoiceId, event.invoiceId));
  await tx.insert(invoiceEvent).values({
    invoiceId: event.invoiceId,
    invoiceApprovalChainId: event.chainId,
    sequenceNumber: (current?.last ?? 0) + 1,
    eventTypeId,
    resultingStatusId: event.statusId,
    occurredAt: new Date(),
    actorUserAccountId: event.actorUserAccountId,
    reason: event.reason,
  });
}
