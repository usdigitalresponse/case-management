// model/workflows.yaml payment_request; each change locks the invoice row first.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { type Database, type Transaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { getReferenceId } from '../../db/referenceLookups';
import { ValidationError } from '../../errors';
import { fieldErrorsFromZodIssues } from '../../intake/validation';
import { caseTable, invoice, invoiceImport, invoiceLine, invoiceStatuses } from '../../db/schema';
import { authorizeBilling, type PortalActor } from '../../portal/portalActor';
import { type ProposedCase, type ProposedProvider } from '../proposedDetails';
import { InvoiceNotFoundError } from '../reviewInvoiceLine';
import { recordInvoiceEvent } from '../invoiceEvents';
import { CONFIRMED_IMPORT_STATUS_CODE, findImportForInvoice } from '../../imports/importedTimeEntries';
import { priceLines } from '../priceLines';
import { caseNumberInput, cleanCaseNumber } from '../caseNumbers';
import { loadCaseNumbers } from '../invoiceDetail';
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

export async function setDraftCaseNumber(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const parsed = z.object({ caseNumber: caseNumberInput }).safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return db.transaction(async (tx) => {
    await lockOwnDraft(tx, actor, invoiceId);
    const caseNumber = cleanCaseNumber(parsed.data.caseNumber);
    await tx.update(invoice).set({ caseNumberAsTyped: caseNumber }).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, caseNumber };
  });
}

// A draft filed by person, put under one of its sender's cases or taken off it
// again (null): with a case, its number is the case's and it goes straight to
// review when sent. Its lines are priced again, so case rates apply.
export async function setDraftCase(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const parsed = z.object({ caseId: z.uuid().nullable() }).safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError({ caseId: 'Choose a case, or say it isn’t listed.' });
  }
  const { caseId } = parsed.data;
  return db.transaction(async (tx) => {
    const locked = await lockOwnDraft(tx, actor, invoiceId);
    let caseNumber = locked.caseNumberAsTyped;
    if (caseId) {
      if (!locked.professionalId) {
        throw new ValidationError({ caseId: 'Choose whose work it is first.' });
      }
      const [target] = await tx.select({ closedOn: caseTable.closedOn }).from(caseTable).where(eq(caseTable.caseId, caseId));
      if (!target || target.closedOn) {
        throw new ValidationError({ caseId: 'Choose an open case.' });
      }
      // Only a case the person whose work it is is on, and that the sender bills for.
      await authorizeBilling(tx, actor, caseId, locked.professionalId);
      caseNumber = (await loadCaseNumbers(tx, [caseId])).get(caseId)?.caseNumber ?? caseNumber;
    }
    await tx.update(invoice).set({ caseId, caseNumberAsTyped: caseNumber }).where(eq(invoice.invoiceId, invoiceId));
    await tx.update(invoiceLine).set({ caseId }).where(eq(invoiceLine.invoiceId, invoiceId));
    await tx.update(invoiceImport).set({ caseId }).where(eq(invoiceImport.invoiceId, invoiceId));
    if (locked.professionalId) {
      await priceLines(tx, invoiceId, { billedProfessionalId: locked.professionalId, unmatchedMeansBilled: true, strict: false });
    }
    return { invoiceId, caseId, caseNumber };
  });
}

export async function setDraftCounty(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const choice = parseCountyChoice(rawInput);
  return db.transaction(async (tx) => {
    await lockOwnDraft(tx, actor, invoiceId);
    const countyId = await resolveCountyChange(tx, actor.userAccountId, choice);
    await tx.update(invoice).set({ countyId }).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, county: await shownInvoiceCounty(tx, invoiceId) };
  });
}

async function lockOwnDraft(tx: Transaction, actor: PortalActor, invoiceId: string) {
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
