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
import { authorizeBilling, type PortalActor } from './portalActor';
import { receiptInputSchema, recordReceipt } from '../billing/invoiceReceipt';
import { proposedCaseSchema, proposedProviderSchema } from '../billing/proposedDetails';

export const createInvoiceInputSchema = draftContentSchema.extend({
  // Null: matched later, in invoice intake.
  caseId: z.string().uuid().nullable(),
  // Defaults to the caller's own profile; a delegate names whom they bill for.
  // Null: chosen when it's matched.
  professionalId: z.string().uuid().nullable().optional(),
  // What the submitter knows of a case or provider that isn't listed.
  proposedCase: proposedCaseSchema.optional(),
  proposedProvider: proposedProviderSchema.optional(),
  submit: z.boolean().default(true),
  // Staff chose to review it with no case (match_invoice_to_case).
  withoutCase: z.boolean().optional(),
  // A submitter sending their own confirms it is true and correct.
  attested: z.boolean().optional(),
}).extend(receiptInputSchema.shape);

export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>;

export interface CreateInvoiceResult {
  invoiceId: string;
  submittedTotal: string;
  status: 'draft' | 'submitted' | 'awaiting_match';
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
  const billedProfessionalId = parsed.data.professionalId === null ? null : (parsed.data.professionalId ?? actor.professionalId ?? null);
  // Checked before measuring trips, which are billed lookups.
  await authorizeBilling(db, actor, caseId, billedProfessionalId);
  if (submit) {
    await measureTrips(db, content.lines.filter((line) => line.lineType === 'mileage'));
  }
  return db.transaction(async (tx) => {
    const invoiceId = await createDraftInTx(tx, actor, caseId, billedProfessionalId, content, {
      proposedCase: parsed.data.proposedCase,
      proposedProvider: parsed.data.proposedProvider,
    });
    await recordReceipt(tx, invoiceId, { receivedVia: parsed.data.receivedVia, receivedOn: parsed.data.receivedOn });
    const status = submit
      ? await submitInTx(tx, actor, invoiceId, { withoutCase: parsed.data.withoutCase, attested: parsed.data.attested })
      : 'draft';
    const [created] = await tx.select({ submittedTotal: invoice.submittedTotal }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, submittedTotal: created?.submittedTotal ?? '0.00', status };
  });
}
