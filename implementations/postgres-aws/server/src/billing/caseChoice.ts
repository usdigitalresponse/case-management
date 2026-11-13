// The case question for a request filed by person (model/rules.yaml
// match_invoice_to_case): an existing case, a new one added from its number
// and county (../cases/caseStep.ts), or not for one case. A draft keeps the
// answer and is matched when sent; in review it applies at once.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { caseTable, invoice, invoiceStatuses, type CaseChoice } from '../db/schema';
import { ForbiddenError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { isStaffAccount, type PortalActor } from '../portal/portalActor';
import { addCaseFromRequest, caseStepMatches, checkNewCase, fillCaseCounty, requireChoosableCase, type NewCaseInput } from '../cases/caseStep';
import { caseNumberInput, currentCaseNumber } from './caseNumbers';
import { requireNotForCaseCounty } from './proposedDetails';
import { lockOwnDraft } from './invoiceLifecycle/drafts';
import { matchInvoiceToCase } from './invoiceIntake';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { LINE_REVIEW_STATUS_CODES } from './invoiceStatusCodes';

const choiceSchema = z.union([
  z.object({ choice: z.literal('existing'), caseId: z.uuid('Choose the case.') }),
  z.object({
    choice: z.literal('new'),
    clientName: z.string().trim().max(200, 'Keep the client’s name under 200 characters.').optional(),
    // Staff said a similar case is a different one.
    confirmedNew: z.boolean().optional(),
    // In review: a number for an invoice that gives none.
    caseNumber: caseNumberInput.optional(),
  }),
  z.object({ choice: z.literal('none') }),
  z.object({ choice: z.null() }),
]);

type ChoiceInput = z.infer<typeof choiceSchema>;

function parseChoice(rawInput: unknown): ChoiceInput {
  const parsed = choiceSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues).choice ? { caseChoice: 'Say which case it is for.' } : fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return parsed.data;
}

// The case this invoice added before, if matching it failed: a retry matches it rather than adding another.
async function addOnce(tx: Transaction, actorUserAccountId: string, invoiceId: string, input: NewCaseInput): Promise<{ caseId: string; added: boolean }> {
  const [earlier] = await tx
    .select({ caseId: caseTable.caseId })
    .from(caseTable)
    .where(and(eq(caseTable.addedFromInvoiceId, invoiceId), eq(caseTable.closedAsMistake, false)));
  if (earlier) return { caseId: earlier.caseId, added: false };
  return { caseId: await addCaseFromRequest(tx, actorUserAccountId, input, { invoiceId }), added: true };
}

// The invoice's number, or one typed in review, and its county, and the cases they find.
export async function caseStepFor(db: DatabaseOrTransaction, invoiceId: string, caseNumber?: string) {
  const [row] = await db
    .select({ caseNumberAsTyped: invoice.caseNumberAsTyped, caseNumberCorrected: invoice.caseNumberCorrected, countyId: invoice.countyId })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row) {
    throw new InvoiceNotFoundError();
  }
  return caseStepMatches(db, caseNumber ?? currentCaseNumber(row), row.countyId);
}

// On a draft: staff may give any answer; an external submitter only "not for one case" or none.
export async function setDraftCaseChoice(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const input = parseChoice(rawInput);
  if (input.choice !== 'none' && input.choice !== null && !(await isStaffAccount(db, actor.userAccountId))) {
    throw new ForbiddenError('staff_only', 'Only the billing office chooses or adds a case.');
  }
  return db.transaction(async (tx) => {
    const locked = await lockOwnDraft(tx, actor, invoiceId);
    if (locked.caseId) {
      throw new ValidationError({ caseChoice: 'It is under one of your cases. Take it off that case first.' });
    }
    if (input.choice === 'existing') {
      await requireChoosableCase(tx, input.caseId, locked.countyId);
    }
    if (input.choice === 'new') {
      await checkNewCase(tx, { caseNumber: currentCaseNumber(locked), countyId: locked.countyId, confirmedNew: input.confirmedNew });
    }
    await tx
      .update(invoice)
      .set({
        caseChoice: input.choice,
        chosenCaseId: input.choice === 'existing' ? input.caseId : null,
        newCaseClientName: input.choice === 'new' ? input.clientName || null : null,
      })
      .where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, caseChoice: input.choice };
  });
}

export interface CaseChoiceResult {
  caseId: string | null;
  // The case added from it, for the guided tour to tag.
  addedCaseId: string | null;
  // Why the chosen case couldn't be matched; it stays chosen to try again in review.
  caseProblem: string | null;
}

async function matchTo(db: Database, actorUserAccountId: string, invoiceId: string, caseId: string, choice: CaseChoice, countyId: string | null) {
  await matchInvoiceToCase(db, actorUserAccountId, invoiceId, { caseId, addMissing: true });
  await fillCaseCounty(db, actorUserAccountId, caseId, countyId);
  await db.update(invoice).set({ caseChoice: choice, chosenCaseId: null, newCaseClientName: null }).where(eq(invoice.invoiceId, invoiceId));
}

function problemOf(error: unknown): string {
  if (error instanceof ValidationError) {
    return Object.values(error.fieldErrors)[0] ?? 'Its case could not be matched.';
  }
  throw error;
}

// After a staff member sends a draft: matches it to the case they chose, or adds it first.
export async function applyCaseChoiceAfterSend(db: Database, actorUserAccountId: string, invoiceId: string): Promise<CaseChoiceResult> {
  const [row] = await db.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
  if (!row || row.caseId || (row.caseChoice !== 'existing' && row.caseChoice !== 'new')) {
    return { caseId: row?.caseId ?? null, addedCaseId: null, caseProblem: null };
  }
  let addedCaseId: string | null = null;
  try {
    let caseId: string;
    if (row.caseChoice === 'existing') {
      if (!row.chosenCaseId) return { caseId: null, addedCaseId: null, caseProblem: 'Say which case it is for.' };
      caseId = row.chosenCaseId;
      await requireChoosableCase(db, caseId, row.countyId);
    } else {
      // A number or county changed since clears the answer (drafts.ts), so a similar case was already confirmed as different.
      const added = await db.transaction((tx) =>
        addOnce(tx, actorUserAccountId, invoiceId, { caseNumber: currentCaseNumber(row), countyId: row.countyId, clientName: row.newCaseClientName, confirmedNew: true }),
      );
      caseId = added.caseId;
      addedCaseId = added.added ? caseId : null;
    }
    await matchTo(db, actorUserAccountId, invoiceId, caseId, row.caseChoice, row.countyId);
    return { caseId, addedCaseId, caseProblem: null };
  } catch (error) {
    return { caseId: null, addedCaseId, caseProblem: problemOf(error) };
  }
}

// A reviewer answering for a request in review without a case.
export async function chooseCaseInReview(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown): Promise<CaseChoiceResult> {
  if (!(await isStaffAccount(db, actorUserAccountId))) {
    throw new ForbiddenError('staff_only', 'Only staff choose an invoice’s case.');
  }
  const input = parseChoice(rawInput);
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const [row] = await db
    .select({ invoice, statusCode: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row) {
    throw new InvoiceNotFoundError();
  }
  if (row.invoice.caseId || !LINE_REVIEW_STATUS_CODES.includes(row.statusCode)) {
    throw new ValidationError({ caseChoice: 'Only an invoice in review without a case can have its case chosen here.' });
  }
  if (input.choice === 'none' || input.choice === null) {
    requireNotForCaseCounty({ caseId: null, caseChoice: input.choice, countyId: row.invoice.countyId });
    await db.update(invoice).set({ caseChoice: input.choice, chosenCaseId: null, newCaseClientName: null }).where(eq(invoice.invoiceId, invoiceId));
    return { caseId: null, addedCaseId: null, caseProblem: null };
  }
  if (input.choice === 'existing') {
    await requireChoosableCase(db, input.caseId, row.invoice.countyId);
    await matchTo(db, actorUserAccountId, invoiceId, input.caseId, 'existing', row.invoice.countyId);
    return { caseId: input.caseId, addedCaseId: null, caseProblem: null };
  }
  const added = await db.transaction((tx) =>
    addOnce(tx, actorUserAccountId, invoiceId, {
      caseNumber: input.caseNumber ?? currentCaseNumber(row.invoice),
      countyId: row.invoice.countyId,
      clientName: input.clientName,
      confirmedNew: input.confirmedNew,
    }),
  );
  const addedCaseId = added.added ? added.caseId : null;
  try {
    await matchTo(db, actorUserAccountId, invoiceId, added.caseId, 'new', row.invoice.countyId);
    return { caseId: added.caseId, addedCaseId, caseProblem: null };
  } catch (error) {
    return { caseId: null, addedCaseId, caseProblem: problemOf(error) };
  }
}
