// How a request staff entered reached the organization, and when
// (model/rules.yaml authorize_staff_invoice_entry). Set with a draft or at
// submission; required to submit a staff-entered request.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { DatabaseOrTransaction, Transaction } from '../db/client';
import { invoice, invoiceReceiptChannels } from '../db/schema';
import { ValidationError } from '../errors';
import { isStaffAccount, type PortalActor } from '../portal/portalActor';

export const receiptInputSchema = z.object({
  receivedVia: z.string().min(1).optional(),
  receivedOn: z.iso.date().optional(),
});

export type ReceiptInput = z.infer<typeof receiptInputSchema>;

export function listReceiptChannels(db: DatabaseOrTransaction) {
  return db
    .select({ code: invoiceReceiptChannels.code, displayName: invoiceReceiptChannels.displayName })
    .from(invoiceReceiptChannels)
    .where(eq(invoiceReceiptChannels.active, true));
}

// Records whichever of the two were given.
export async function recordReceipt(tx: Transaction, invoiceId: string, input: ReceiptInput): Promise<void> {
  const changes: { receivedViaId?: string; receivedOn?: string } = {};
  if (input.receivedVia) {
    const [channel] = await tx
      .select({ id: invoiceReceiptChannels.id })
      .from(invoiceReceiptChannels)
      .where(eq(invoiceReceiptChannels.code, input.receivedVia));
    if (!channel) {
      throw new ValidationError({ receivedVia: 'Choose how the invoice was received.' });
    }
    changes.receivedViaId = channel.id;
  }
  if (input.receivedOn) {
    if (input.receivedOn > new Date().toISOString().slice(0, 10)) {
      throw new ValidationError({ receivedOn: 'The date received cannot be in the future.' });
    }
    changes.receivedOn = input.receivedOn;
  }
  if (Object.keys(changes).length > 0) {
    await tx.update(invoice).set(changes).where(eq(invoice.invoiceId, invoiceId));
  }
}

// Staff entering a request for someone else must say how and when it came in.
export async function requireReceiptForStaffEntry(
  tx: Transaction,
  actor: PortalActor,
  row: { professionalId: string; receivedViaId: string | null; receivedOn: string | null },
): Promise<void> {
  if (row.professionalId === actor.professionalId || !(await isStaffAccount(tx, actor.userAccountId))) {
    return;
  }
  const errors: Record<string, string> = {};
  if (!row.receivedViaId) errors.receivedVia = 'Say how this invoice was received.';
  if (!row.receivedOn) errors.receivedOn = 'Enter the date this invoice was received.';
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
}
