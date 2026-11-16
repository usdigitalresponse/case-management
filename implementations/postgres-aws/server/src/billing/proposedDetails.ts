// Details a submitter enters when the case, provider or a line's timekeeper
// isn't listed (model/rules.yaml match_invoice_to_case). They never create
// records; a request carrying any unresolved one sent before the case step waits in intake.
import { z } from 'zod';
import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invoiceLine } from '../db/schema';
import { optionalEmail } from '../people/emails';
import { ValidationError } from '../errors';

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

// What staff still have to match before the request can go to review. One
// filed by person needs no case: it says which case it is for, or not.
export async function needsMatching(
  tx: Transaction,
  row: { invoiceId: string; caseId: string | null; professionalId: string | null; caseNumberAsTyped: string | null },
  options: { withoutCase?: boolean; filedByPerson?: boolean } = {},
): Promise<boolean> {
  const caseKnown = row.caseId !== null || Boolean(row.caseNumberAsTyped) || options.withoutCase || options.filedByPerson;
  if (!caseKnown || row.professionalId === null) {
    return true;
  }
  return hasUnmatchedTimekeepers(tx, row.invoiceId);
}

// Staff must answer the case question (../billing/caseChoice.ts) before sending, or finishing an entry's first round.
export function requireCaseAnswered(row: { caseId: string | null; caseChoice: string | null; countyId: string | null }) {
  if (!row.caseId && !row.caseChoice) {
    throw new ValidationError({ caseChoice: 'Say which case this invoice is for, or that it isn’t for one case.' });
  }
  requireNotForCaseCounty(row);
}

// Work not for one case counts only under its own county.
export function requireNotForCaseCounty(row: { caseId: string | null; caseChoice: string | null; countyId: string | null }) {
  if (!row.caseId && row.caseChoice === 'none' && !row.countyId) {
    throw new ValidationError({ countyId: 'Add the county: work not for one case counts under it.' });
  }
}
