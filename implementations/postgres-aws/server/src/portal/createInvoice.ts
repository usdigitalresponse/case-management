// Creates a portal invoice as a draft, submitted straight away unless asked
// not to. Time and mileage are priced from configured rates.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { invoice, supportingInvoice } from '../db/schema';
import { enterInReviewInTx } from '../billing/enterInReview';
import { createDraftInTx, draftContentSchema, parseDraftContent, submitInTx } from '../billing/invoiceLifecycle';
import { measureTrips } from '../billing/routeCheck';
import { authorizeBilling, type PortalActor } from './portalActor';
import { receiptInputSchema, recordReceipt } from '../billing/invoiceReceipt';
import { proposedCaseSchema, proposedProviderSchema } from '../billing/proposedDetails';
import { caseNumberInput, cleanCaseNumber } from '../billing/caseNumbers';
import { countyChoice, resolveCounty } from '../cases/counties';

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
  // Given, the invoice is filed by person and sent as such.
  caseNumber: caseNumberInput.optional(),
  ...countyChoice,
  // The number on the sender's own invoice, kept as its supporting invoice.
  invoiceNumber: z.string().trim().max(100, 'Keep the invoice number under 100 characters.').optional(),
  // A reviewing staff member's draft goes straight into their own review
  // (../billing/enterInReview.ts).
  enterInReview: z.boolean().optional(),
}).extend(receiptInputSchema.shape);

export type CreateInvoiceInput = z.input<typeof createInvoiceInputSchema>;

export interface CreateInvoiceResult {
  invoiceId: string;
  submittedTotal: string;
  status: 'draft' | 'submitted' | 'awaiting_match' | 'under_review';
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
    const caseNumber = cleanCaseNumber(parsed.data.caseNumber);
    if (caseNumber) {
      await tx.update(invoice).set({ caseNumberAsTyped: caseNumber }).where(eq(invoice.invoiceId, invoiceId));
    }
    const countyId = await resolveCounty(tx, actor.userAccountId, parsed.data);
    if (countyId) {
      await tx.update(invoice).set({ countyId }).where(eq(invoice.invoiceId, invoiceId));
    }
    if (parsed.data.invoiceNumber) {
      await tx.insert(supportingInvoice).values({
        invoiceId,
        invoiceNumber: parsed.data.invoiceNumber,
        periodStart: content.periodStart ?? null,
        periodEnd: content.periodEnd ?? null,
      });
    }
    if (parsed.data.enterInReview) {
      if (submit) {
        throw new ValidationError({ enterInReview: 'An invoice entered in review is not sent.' });
      }
      await enterInReviewInTx(tx, actor.userAccountId, invoiceId);
      return { invoiceId, submittedTotal: await totalOf(tx, invoiceId), status: 'under_review' as const };
    }
    const status = submit
      ? await submitInTx(tx, actor, invoiceId, {
          withoutCase: parsed.data.withoutCase,
          attested: parsed.data.attested,
          filedByPerson: caseNumber !== null,
        })
      : 'draft';
    return { invoiceId, submittedTotal: await totalOf(tx, invoiceId), status };
  });
}

async function totalOf(tx: Transaction, invoiceId: string): Promise<string> {
  const [created] = await tx.select({ submittedTotal: invoice.submittedTotal }).from(invoice).where(eq(invoice.invoiceId, invoiceId));
  return created?.submittedTotal ?? '0.00';
}
