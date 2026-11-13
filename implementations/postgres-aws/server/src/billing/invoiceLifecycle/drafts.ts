// model/workflows.yaml payment_request; each change locks the invoice row first.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { type Database, type Transaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { getReferenceId } from '../../db/referenceLookups';
import { ForbiddenError, ValidationError } from '../../errors';
import { fieldErrorsFromZodIssues } from '../../intake/validation';
import { invoice, invoiceStatuses } from '../../db/schema';
import { authorizeBilling, isStaffAccount, type PortalActor } from '../../portal/portalActor';
import { type ProposedCase, type ProposedProvider } from '../proposedDetails';
import { InvoiceNotFoundError } from '../reviewInvoiceLine';
import { recordInvoiceEvent } from '../invoiceEvents';
import { CONFIRMED_IMPORT_STATUS_CODE, findImportForInvoice } from '../../imports/importedTimeEntries';
import { caseNumberInput, cleanCaseNumber } from '../caseNumbers';
import { parseCountyChoice, resolveCountyChange, shownInvoiceCounty } from '../../cases/counties';
import { changeSenderInTx, parseDetails, parseSender, setDetailsInTx } from '../uploadDetails';
import { DRAFT_INVOICE_STATUS_CODE } from '../invoiceStatusCodes';
import { DraftContent, InvoiceStateError, parseDraftContent } from './lineInput';
import { replaceLines } from './replaceLines';

export async function statusId(tx: Transaction, code: string): Promise<string> {
  return getReferenceId(tx, invoiceStatuses, code);
}

export async function createDraftInTx(
  tx: Transaction,
  actor: PortalActor,
  caseId: string | null,
  billedProfessionalId: string | null,
  content: DraftContent,
  options: { fillTimekeepers?: boolean; proposedCase?: ProposedCase; proposedProvider?: ProposedProvider } = {},
): Promise<string> {
  const draftStatusId = await statusId(tx, DRAFT_INVOICE_STATUS_CODE);
  const { invoiceId } = firstRow(
    await tx
      .insert(invoice)
      .values({
        submittedByUserAccountId: actor.userAccountId,
        professionalId: billedProfessionalId,
        statusId: draftStatusId,
        submittedTotal: '0.00',
        caseId,
        periodStart: content.periodStart,
        periodEnd: content.periodEnd,
        proposedCase: caseId === null ? options.proposedCase : undefined,
        proposedProvider: billedProfessionalId === null ? options.proposedProvider : undefined,
      })
      .returning({ invoiceId: invoice.invoiceId }),
  );
  const total = await replaceLines(tx, actor, invoiceId, caseId, billedProfessionalId, content, options.fillTimekeepers ?? true);
  await tx.update(invoice).set({ submittedTotal: total }).where(eq(invoice.invoiceId, invoiceId));
  await recordInvoiceEvent(tx, {
    invoiceId,
    eventTypeCode: 'draft_created',
    statusId: draftStatusId,
    actorUserAccountId: actor.userAccountId,
  });
  return invoiceId;
}

// Someone else's invoice is "not found"; an ended assignment or delegation
// blocks further changes.
export async function lockOwnInvoice(tx: Transaction, actor: PortalActor, invoiceId: string) {
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const [locked] = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId)).for('update');
  if (!locked || locked.submittedByUserAccountId !== actor.userAccountId) {
    throw new InvoiceNotFoundError();
  }
  const billable = await authorizeBilling(tx, actor, locked.caseId, locked.professionalId);
  return { locked, billable };
}

export async function requireStaffForCase(db: Database | Transaction, actor: PortalActor) {
  if (!(await isStaffAccount(db, actor.userAccountId))) {
    throw new ForbiddenError('staff_only', 'The billing office adds the case number during review.');
  }
}

export async function updateDraftInvoice(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const content = parseDraftContent(rawInput);
  return db.transaction(async (tx) => {
    const locked = await lockOwnDraft(tx, actor, invoiceId);
    const imported = await findImportForInvoice(tx, invoiceId);
    const fillTimekeepers = !imported || imported.statusCode === CONFIRMED_IMPORT_STATUS_CODE;
    const total = await replaceLines(tx, actor, invoiceId, locked.caseId, locked.professionalId, content, fillTimekeepers);
    await tx
      .update(invoice)
      .set({ submittedTotal: total, periodStart: content.periodStart ?? null, periodEnd: content.periodEnd ?? null })
      .where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, submittedTotal: total };
  });
}

// Staff only: an external sender's number is the one read from their file (model/rules.yaml match_invoice_to_case).
export async function setDraftCaseNumber(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  await requireStaffForCase(db, actor);
  const parsed = z.object({ caseNumber: caseNumberInput }).safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return db.transaction(async (tx) => {
    const locked = await lockOwnDraft(tx, actor, invoiceId);
    const caseNumber = cleanCaseNumber(parsed.data.caseNumber);
    await tx
      .update(invoice)
      .set({ caseNumberAsTyped: caseNumber, ...(caseNumber === locked.caseNumberAsTyped ? {} : askCaseAgain(locked)) })
      .where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, caseNumber };
  });
}

export async function setDraftCounty(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const choice = parseCountyChoice(rawInput);
  return db.transaction(async (tx) => {
    const locked = await lockOwnDraft(tx, actor, invoiceId);
    const countyId = await resolveCountyChange(tx, actor.userAccountId, choice);
    await tx
      .update(invoice)
      .set({ countyId, ...(countyId === locked.countyId ? {} : askCaseAgain(locked)) })
      .where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, county: await shownInvoiceCounty(tx, invoiceId) };
  });
}

// A case found or added from the old number or county no longer answers; "not for one case" still does.
function askCaseAgain(locked: { caseChoice: string | null }) {
  return locked.caseChoice === 'existing' || locked.caseChoice === 'new' ? { caseChoice: null, chosenCaseId: null } : {};
}

export async function lockOwnDraft(tx: Transaction, actor: PortalActor, invoiceId: string) {
  const { locked } = await lockOwnInvoice(tx, actor, invoiceId);
  if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
    throw new InvoiceStateError('Only a draft can be edited.');
  }
  return locked;
}

export async function setDraftSender(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const choice = parseSender(rawInput);
  return db.transaction(async (tx) => {
    await changeSenderInTx(tx, actor, await lockOwnDraft(tx, actor, invoiceId), choice);
    return { invoiceId };
  });
}

export async function setDraftDetails(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const details = parseDetails(rawInput);
  return db.transaction(async (tx) => {
    await lockOwnDraft(tx, actor, invoiceId);
    await setDetailsInTx(tx, invoiceId, details);
    return { invoiceId };
  });
}
