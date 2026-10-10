// Appends to an invoice's immutable history (model/schema.yaml invoice_event).
// Callers hold the invoice row lock so sequence numbers can't collide.
import { eq, max } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { getReferenceId } from '../db/referenceLookups';
import { invoiceEvent, invoiceEventTypes } from '../db/schema';

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
