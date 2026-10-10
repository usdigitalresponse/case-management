// Creates a portal invoice as a draft, submitted straight away unless asked
// not to. Amounts are vendor-entered; there's no billing-rate entity.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { invoice } from '../db/schema';
import { createDraftInTx, draftContentSchema, parseDraftContent, submitInTx } from '../billing/invoiceLifecycle';
import type { PortalActor } from './portalActor';

export const createInvoiceInputSchema = draftContentSchema.extend({
  caseId: z.string().uuid(),
  // Defaults to the caller's own profile; a delegate names whom they bill for.
  professionalId: z.string().uuid().optional(),
  submit: z.boolean().default(true),
});

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
  const billedProfessionalId = parsed.data.professionalId ?? actor.professionalId;
  if (!billedProfessionalId) {
    throw new ValidationError({ professionalId: 'Choose the professional this invoice bills for.' });
  }

  return db.transaction(async (tx) => {
    const invoiceId = await createDraftInTx(tx, actor, caseId, billedProfessionalId, content);
    if (submit) {
      await submitInTx(tx, actor, invoiceId);
    }
    const [created] = await tx.select({ submittedTotal: invoice.submittedTotal }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, submittedTotal: created?.submittedTotal ?? '0.00' };
  });
}
