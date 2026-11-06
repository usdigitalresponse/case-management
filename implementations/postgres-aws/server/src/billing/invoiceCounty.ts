// A reviewer changes a sent invoice's county; audited with the county shown
// before and the invoice's own.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { auditEvent, invoice, invoiceStatuses } from '../db/schema';
import { ConflictError } from '../errors';
import { parseCountyChoice, resolveCountyChange, shownInvoiceCounty } from '../cases/counties';
import { requireReviewPermission } from './reviewAccess';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { UNSUBMITTED_INVOICE_STATUS_CODES } from './invoiceStatusCodes';
import { entryIsOpen } from './enterInReview';

export async function changeInvoiceCounty(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const choice = parseCountyChoice(rawInput);
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  await requireReviewPermission(db, actorUserAccountId, 'reviewLines');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ countyId: invoice.countyId, statusCode: invoiceStatuses.code })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(eq(invoice.invoiceId, invoiceId))
      .for('update', { of: invoice });
    if (!row) {
      throw new InvoiceNotFoundError();
    }
    if (UNSUBMITTED_INVOICE_STATUS_CODES.includes(row.statusCode)) {
      throw new ConflictError('invalid_state', 'Only a sent invoice’s county can be changed here.');
    }
    // Its reviewer sets it while entering (./enterInReview.ts setEnteredCounty).
    if (await entryIsOpen(tx, invoiceId)) {
      throw new ConflictError('invalid_state', 'This invoice is still being entered. Change its county there.');
    }
    const countyId = await resolveCountyChange(tx, actorUserAccountId, choice);
    // Under a case, clearing its own county shows the case's again.
    const before = await shownInvoiceCounty(tx, invoiceId);
    await tx.update(invoice).set({ countyId }).where(eq(invoice.invoiceId, invoiceId));
    const after = await shownInvoiceCounty(tx, invoiceId);
    if (after?.countyId !== before?.countyId) {
      await tx.insert(auditEvent).values({
        entityType: 'invoice',
        entityId: invoiceId,
        eventType: 'county_changed',
        actorUserAccountId,
        occurredAt: new Date(),
        priorValues: { countyId: before?.countyId ?? null, ownCountyId: row.countyId },
      });
    }
    return { invoiceId, county: after };
  });
}
