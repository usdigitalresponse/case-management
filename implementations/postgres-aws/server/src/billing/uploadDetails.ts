// A filed-by-person draft's or open entry's sender, period and invoice number,
// edited beside its lines.
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invoice, invoiceLine, professional, professionalKinds, supportingInvoice } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { authorizeBilling, type PortalActor } from '../portal/portalActor';
import { CONFIRMED_IMPORT_STATUS_CODE, findImportForInvoice } from '../imports/importedTimeEntries';
import { recheckDuplicates } from '../imports/duplicateWarnings';
import { requireReviewPermission } from './reviewAccess';
import { priceLines } from './priceLines';
import { fillUnmatchedTimekeepers } from './timekeeperFallback';

const senderSchema = z.object({
  professionalId: z.uuid('Choose who this invoice is from.'),
  // Their role, for someone who has none yet; a reviewer may give it.
  professionalKindId: z.uuid('Choose their role.').optional(),
});

export type SenderChoice = z.infer<typeof senderSchema>;

export function parseSender(rawInput: unknown): SenderChoice {
  const parsed = senderSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return parsed.data;
}

// Only a role that is missing; an administrator changes one under People.
async function giveMissingRole(tx: Transaction, actor: PortalActor, professionalId: string, professionalKindId: string) {
  await requireReviewPermission(tx, actor.userAccountId, 'reviewLines');
  const [kind] = await tx
    .select({ id: professionalKinds.id })
    .from(professionalKinds)
    .where(and(eq(professionalKinds.id, professionalKindId), eq(professionalKinds.active, true)));
  if (!kind) {
    throw new ValidationError({ professionalKindId: 'Choose one of the listed roles.' });
  }
  const [given] = await tx
    .update(professional)
    .set({ professionalKindId })
    .where(and(eq(professional.professionalId, professionalId), isNull(professional.professionalKindId)))
    .returning({ professionalId: professional.professionalId });
  if (!given) {
    throw new ValidationError({ professionalKindId: 'They already have a role. An administrator changes it under People.' });
  }
}

// Files it under the chosen person and prices its lines at their rates.
export async function changeSenderInTx(
  tx: Transaction,
  actor: PortalActor,
  row: { invoiceId: string; caseId: string | null; professionalId: string | null },
  { professionalId, professionalKindId }: SenderChoice,
): Promise<void> {
  if (row.caseId !== null) {
    throw new ValidationError({ professionalId: 'Its case says whom this invoice bills.' });
  }
  await authorizeBilling(tx, actor, null, professionalId);
  if (professionalKindId) await giveMissingRole(tx, actor, professionalId, professionalKindId);
  // Saved again unchanged, it is priced again, as after their role was corrected.
  const changed = row.professionalId !== professionalId;
  const { invoiceId } = row;
  if (changed && row.professionalId) {
    // Lines given to the earlier sender were given through that choice.
    await tx
      .update(invoiceLine)
      .set({ timekeeperProfessionalId: professionalId })
      .where(
        and(
          eq(invoiceLine.invoiceId, invoiceId),
          eq(invoiceLine.timekeeperProfessionalId, row.professionalId),
          isNull(invoiceLine.sourceTimeEntryId),
        ),
      );
  }
  if (changed) {
    await tx.update(invoice).set({ professionalId, proposedProvider: null }).where(eq(invoice.invoiceId, invoiceId));
    await recheckDuplicates(tx, invoiceId, professionalId);
  }
  // An unconfirmed import's unmatched lines stay unmatched until it is confirmed.
  const imported = await findImportForInvoice(tx, invoiceId);
  const confirmed = !imported || imported.statusCode === CONFIRMED_IMPORT_STATUS_CODE;
  if (confirmed) await fillUnmatchedTimekeepers(tx, invoiceId, professionalId);
  await priceLines(tx, invoiceId, { billedProfessionalId: professionalId, unmatchedMeansBilled: confirmed, strict: false });
}

const detailsSchema = z
  .object({
    periodStart: z.iso.date('Enter the first day of the billing period.').nullable(),
    periodEnd: z.iso.date('Enter the last day of the billing period.').nullable(),
    invoiceNumber: z.string().trim().max(100, 'Keep the invoice number under 100 characters.').nullable(),
  })
  .refine((input) => Boolean(input.periodStart) === Boolean(input.periodEnd), {
    message: 'Enter both days of the billing period, or neither.',
    path: ['periodEnd'],
  })
  .refine((input) => !input.periodStart || !input.periodEnd || input.periodEnd >= input.periodStart, {
    message: 'The billing period must end on or after its first day.',
    path: ['periodEnd'],
  });

export type InvoiceDetailsInput = z.infer<typeof detailsSchema>;

export function parseDetails(rawInput: unknown): InvoiceDetailsInput {
  const parsed = detailsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return parsed.data;
}

// An empty invoice number removes the supporting invoice, which holds only it.
export async function setDetailsInTx(tx: Transaction, invoiceId: string, details: InvoiceDetailsInput): Promise<void> {
  const period = { periodStart: details.periodStart, periodEnd: details.periodEnd };
  await tx.update(invoice).set(period).where(eq(invoice.invoiceId, invoiceId));
  const invoiceNumber = details.invoiceNumber || null;
  const [existing] = await tx
    .select({ id: supportingInvoice.supportingInvoiceId })
    .from(supportingInvoice)
    .where(eq(supportingInvoice.invoiceId, invoiceId))
    .limit(1);
  if (!invoiceNumber) {
    if (existing) await tx.delete(supportingInvoice).where(eq(supportingInvoice.invoiceId, invoiceId));
  } else if (existing) {
    await tx.update(supportingInvoice).set({ invoiceNumber, ...period }).where(eq(supportingInvoice.supportingInvoiceId, existing.id));
  } else {
    await tx.insert(supportingInvoice).values({ invoiceId, invoiceNumber, ...period });
  }
}
