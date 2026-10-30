// Details a submitter enters when the case, provider or a line's timekeeper
// isn't listed (model/rules.yaml match_invoice_to_case). They never create
// records; a request carrying any unresolved one waits in intake.
import { z } from 'zod';
import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invoiceLine } from '../db/schema';
import { optionalEmail } from '../people/emails';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => value || undefined);

export const proposedCaseSchema = z.object({
  clientName: text(200).min(2, 'Enter the client’s name.'),
  caseNumber: optionalText(100),
  details: optionalText(1000),
});

export const proposedProviderSchema = z.object({
  displayName: text(200).min(2, 'Enter their name.'),
  email: optionalEmail,
  professionalKindId: z.uuid().optional(),
});

export type ProposedCase = z.infer<typeof proposedCaseSchema>;
export type ProposedProvider = z.infer<typeof proposedProviderSchema>;

// A line naming someone not listed whom staff haven't matched yet.
export const unmatchedTimekeeper: SQL = and(isNotNull(invoiceLine.proposedTimekeeperName), isNull(invoiceLine.timekeeperProfessionalId))!;

export async function hasUnmatchedTimekeepers(tx: Transaction, invoiceId: string): Promise<boolean> {
  const [line] = await tx
    .select({ id: invoiceLine.invoiceLineId })
    .from(invoiceLine)
    .where(and(eq(invoiceLine.invoiceId, invoiceId), unmatchedTimekeeper))
    .limit(1);
  return Boolean(line);
}

// What staff still have to match before the request can go to review.
export async function needsMatching(
  tx: Transaction,
  row: { invoiceId: string; caseId: string | null; professionalId: string | null },
  options: { withoutCase?: boolean } = {},
): Promise<boolean> {
  if ((row.caseId === null && !options.withoutCase) || row.professionalId === null) {
    return true;
  }
  return hasUnmatchedTimekeepers(tx, row.invoiceId);
}
