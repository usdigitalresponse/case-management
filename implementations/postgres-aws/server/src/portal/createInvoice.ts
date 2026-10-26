// Creates a portal invoice as a draft, submitted straight away unless asked
// not to. Time and mileage are priced from configured rates.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { invoice } from '../db/schema';
import { createDraftInTx, draftContentSchema, parseDraftContent, submitInTx } from '../billing/invoiceLifecycle';
import { measureTrips } from '../billing/routeCheck';
import { billableProfessionalIds, type PortalActor } from './portalActor';
import { receiptInputSchema, recordReceipt } from '../billing/invoiceReceipt';

export const createInvoiceInputSchema = draftContentSchema.extend({
  // Null: staff will add the case later, from invoice intake.
  caseId: z.string().uuid().nullable(),
  // Defaults to the caller's own profile; a delegate names whom they bill for.
  // Null: staff will choose when they match it to a case (no case only).
  professionalId: z.string().uuid().nullable().optional(),
  submit: z.boolean().default(true),
  // Staff chose to review it with no case (match_invoice_to_case).
  withoutCase: z.boolean().optional(),
}).extend(receiptInputSchema.shape);

export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>;

export interface CreateInvoiceResult {
  invoiceId: string;
  submittedTotal: string;
}

export async function createInvoice(
  db: Database,
  actor: PortalActor,
  rawInput: unknown,
): Promise<CreateInvoiceResult> {
  const parsed = createInvoiceInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { caseId, submit } = parsed.data;
  const content = parseDraftContent(parsed.data);
  const later = parsed.data.professionalId === null;
  const billedProfessionalId = later ? null : (parsed.data.professionalId ?? actor.professionalId ?? null);
  if (!billedProfessionalId && !(later && caseId === null && !submit)) {
    throw new ValidationError({ professionalId: 'Choose the professional this invoice bills for.' });
  }

  if (submit && billedProfessionalId && (await billableProfessionalIds(db, actor, caseId)).includes(billedProfessionalId)) {
    await measureTrips(db, content.lines.filter((line) => line.lineType === 'mileage'));
  }
  return db.transaction(async (tx) => {
    const invoiceId = await createDraftInTx(tx, actor, caseId, billedProfessionalId, content);
    await recordReceipt(tx, invoiceId, { receivedVia: parsed.data.receivedVia, receivedOn: parsed.data.receivedOn });
    if (submit) {
      await submitInTx(tx, actor, invoiceId, { withoutCase: parsed.data.withoutCase });
    }
    const [created] = await tx.select({ submittedTotal: invoice.submittedTotal }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, submittedTotal: created?.submittedTotal ?? '0.00' };
  });
}
