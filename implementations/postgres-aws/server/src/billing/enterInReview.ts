// A reviewer's upload or invoice entered by hand is under review from the
// start, given to them: they enter its lines and decide them in one pass. The lines stay editable
// until the first round freezes them (model/rules.yaml enter_request_in_review).
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, DatabaseOrTransaction, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceImport,
  invoiceImportStatuses,
  invoiceLine,
  invoiceLineWorkingDecision,
  invoiceReviewQuestion,
  invoiceStatuses,
  trip,
  userAccount,
} from '../db/schema';
import { isStaffAccount, resolvePortalActor } from '../portal/portalActor';
import { CONFIRMED_IMPORT_STATUS_CODE, findImportForInvoice } from '../imports/importedTimeEntries';
import { confirmImportInTx } from '../imports/invoiceImports';
import type { DocumentStore } from '../imports/documentStore';
import { requireImportedDates } from '../imports/undatedLines';
import { caseNumberInput, cleanCaseNumber } from './caseNumbers';
import { parseCountyChoice, resolveCountyChange, shownInvoiceCounty } from '../cases/counties';
import { recordInvoiceEvent } from './invoiceEvents';
import { freezeRequest, InvoiceStateError, MILEAGE_EXPENSE_TYPE_CODE, parseDraftContent, replaceLines } from './invoiceLifecycle';
import { receiptInputSchema, recordReceipt, requireReceiptForStaffEntry, type ReceiptInput } from './invoiceReceipt';
import { DRAFT_INVOICE_STATUS_CODE, LINE_REVIEW_STATUS_CODES, UNDER_REVIEW_INVOICE_STATUS_CODE } from './invoiceStatusCodes';
import { requireReviewPermission } from './reviewAccess';
import { assignForEntry, loadAssignments, lockInvoiceForReview, NotYourInvoiceError } from './reviewAssignment';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { priceLines } from './priceLines';
import { measureTrips } from './routeCheck';
import { fillUnmatchedTimekeepers } from './timekeeperFallback';
import { changeSenderInTx, parseDetails, parseSender, setDetailsInTx } from './uploadDetails';

export class EntryClosedError extends ConflictError {
  constructor() {
    super('invalid_state', 'The lines were locked when the review was finished, so they can no longer be changed.');
  }
}

// The invoice with its current attempt. Entry is open until the first round
// is finished, which freezes the request in the attempt's snapshot.
async function currentEntry(db: DatabaseOrTransaction, invoiceId: string) {
  const [found] = await db
    .select({ row: invoice, chainId: invoiceApprovalChain.invoiceApprovalChainId, snapshot: invoiceApprovalChain.submissionSnapshot })
    .from(invoice)
    .innerJoin(
      invoiceApprovalChain,
      and(eq(invoiceApprovalChain.invoiceId, invoice.invoiceId), isNull(invoiceApprovalChain.supersededAt)),
    )
    .where(eq(invoice.invoiceId, invoiceId));
  return found ? { row: found.row, chainId: found.chainId, open: found.row.enteredInReview && found.snapshot === null } : undefined;
}

export async function entryIsOpen(db: DatabaseOrTransaction, invoiceId: string): Promise<boolean> {
  return Boolean((await currentEntry(db, invoiceId))?.open);
}

// A reviewing staff member's new draft, filed under the person it is from,
// goes straight to their review. Called in the transaction that makes the
// draft, so an upload is either in review or not made at all.
export async function enterInReviewInTx(tx: Transaction, actorUserAccountId: string, invoiceId: string): Promise<void> {
  await requireReviewPermission(tx, actorUserAccountId, 'reviewLines');
  const [locked] = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId)).for('update');
  if (!locked || locked.submittedByUserAccountId !== actorUserAccountId || !(await isStaffAccount(tx, actorUserAccountId))) {
    throw new InvoiceNotFoundError();
  }
  if (locked.statusId !== (await getReferenceId(tx, invoiceStatuses, DRAFT_INVOICE_STATUS_CODE))) {
    throw new InvoiceStateError('Only a new upload can be entered in review.');
  }
  // Whom it is from may be chosen while entering; finishing needs it (closeEntry).
  const startedAt = new Date();
  const statusId = await getReferenceId(tx, invoiceStatuses, UNDER_REVIEW_INVOICE_STATUS_CODE);
  await tx
    .update(invoice)
    .set({ statusId, submittedAt: startedAt, enteredInReview: true, linesChangedAt: startedAt, linesChangedByUserAccountId: actorUserAccountId })
    .where(eq(invoice.invoiceId, invoiceId));
  // Its snapshot is taken when the first round is finished.
  const { chainId } = firstRow(
    await tx
      .insert(invoiceApprovalChain)
      .values({ invoiceId, createdByUserAccountId: actorUserAccountId, createdAt: startedAt })
      .returning({ chainId: invoiceApprovalChain.invoiceApprovalChainId }),
  );
  await assignForEntry(tx, invoiceId, actorUserAccountId);
  await recordInvoiceEvent(tx, { invoiceId, eventTypeCode: 'review_started', statusId, actorUserAccountId, chainId });
}

// A reviewer's draft from before uploads went straight into review, continued
// as one would be.
export async function enterDraftInReview(db: Database, actorUserAccountId: string, invoiceId: string) {
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  await db.transaction((tx) => enterInReviewInTx(tx, actorUserAccountId, invoiceId));
  return { invoiceId };
}

// The invoice's reviewer, while its entry is open and they still review.
async function lockOpenEntry(tx: Transaction, actorUserAccountId: string, invoiceId: string) {
  await requireReviewPermission(tx, actorUserAccountId, 'reviewLines');
  const locked = await lockInvoiceForReview(tx, invoiceId);
  const entry = await currentEntry(tx, invoiceId);
  if (!entry?.open) {
    throw new EntryClosedError();
  }
  if (!LINE_REVIEW_STATUS_CODES.includes(locked.statusCode)) {
    throw new InvoiceStateError('Lines can only be entered while the invoice is being reviewed.');
  }
  const { reviewer } = await loadAssignments(tx, invoiceId);
  if (reviewer?.userAccountId !== actorUserAccountId) {
    throw new NotYourInvoiceError(reviewer?.displayName ?? 'Someone else');
  }
  return entry;
}

// Everything a line's decision was made against, its trip's included; a
// change undoes the decision. Freezing links time lines to new time entries,
// which changes nothing decided (withTimeEntry false).
async function lineValues(tx: Transaction, invoiceId: string, withTimeEntry = true) {
  const rows = await tx
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeId: invoiceLine.lineTypeId,
      expenseTypeId: invoiceLine.expenseTypeId,
      amount: invoiceLine.amount,
      quantity: invoiceLine.quantity,
      unitRate: invoiceLine.unitRate,
      statedAmount: invoiceLine.statedAmount,
      billedRate: invoiceLine.billedRate,
      serviceDate: invoiceLine.serviceDate,
      description: invoiceLine.description,
      taskCode: invoiceLine.taskCode,
      activityCode: invoiceLine.activityCode,
      expenseCode: invoiceLine.expenseCode,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      proposedTimekeeperName: invoiceLine.proposedTimekeeperName,
      sourceTimeEntryId: invoiceLine.sourceTimeEntryId,
      timeCategory: invoiceLine.timeCategory,
      tripOrigin: trip.tripOrigin,
      tripDestination: trip.tripDestination,
      roundTrip: trip.roundTrip,
    })
    .from(invoiceLine)
    .leftJoin(trip, eq(invoiceLine.tripId, trip.tripId))
    .where(eq(invoiceLine.invoiceId, invoiceId));
  return new Map(
    rows.map(({ invoiceLineId, sourceTimeEntryId, ...values }) => [
      invoiceLineId,
      JSON.stringify(withTimeEntry ? { ...values, sourceTimeEntryId } : values),
    ]),
  );
}

async function decidedLineIds(tx: Transaction, chainId: string): Promise<string[]> {
  const rows = await tx
    .select({ invoiceLineId: invoiceLineWorkingDecision.invoiceLineId })
    .from(invoiceLineWorkingDecision)
    .where(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId));
  return rows.map((row) => row.invoiceLineId);
}

async function clearDecisions(tx: Transaction, chainId: string, invoiceLineIds: string[]) {
  if (invoiceLineIds.length === 0) return;
  await tx
    .delete(invoiceLineWorkingDecision)
    .where(and(eq(invoiceLineWorkingDecision.invoiceApprovalChainId, chainId), inArray(invoiceLineWorkingDecision.invoiceLineId, invoiceLineIds)));
}

// The lines changed after the page saving them was loaded, in another tab
// or by whoever had the invoice before.
export class StaleLinesError extends ConflictError {
  // changedBy: null when it was the actor, in another tab or window.
  constructor(changedBy: string | null) {
    super(
      'stale_lines',
      `${changedBy === null ? 'You changed these lines in another tab or window' : `${changedBy} changed these lines`} after this page was loaded, so your change wasn't saved. The latest lines are shown now; make your change again.`,
    );
  }
}

// Refuses a change made from a page showing lines older than these: a line
// save, or a decision on an entry still open.
export async function requireCurrentLines(
  tx: Transaction,
  row: { linesVersion: number; linesChangedByUserAccountId: string | null },
  actorUserAccountId: string,
  linesVersion: number | undefined,
): Promise<void> {
  if (row.linesVersion === linesVersion) return;
  const [changer] = row.linesChangedByUserAccountId
    ? await tx.select({ name: userAccount.displayName }).from(userAccount).where(eq(userAccount.userAccountId, row.linesChangedByUserAccountId))
    : [];
  throw new StaleLinesError(row.linesChangedByUserAccountId === actorUserAccountId ? null : (changer?.name ?? 'Someone else'));
}

// While an entry is open, the version the deciding page showed must be the latest.
export async function requireCurrentEntryLines(tx: Transaction, invoiceId: string, actorUserAccountId: string, linesVersion: number | undefined) {
  const entry = await currentEntry(tx, invoiceId);
  if (entry?.open) {
    await requireCurrentLines(tx, entry.row, actorUserAccountId, linesVersion);
  }
}

// A change to its lines, and who made it.
async function markLinesChanged(tx: Transaction, invoiceId: string, actorUserAccountId: string, version: number): Promise<number> {
  await tx
    .update(invoice)
    .set({ linesVersion: version + 1, linesChangedAt: new Date(), linesChangedByUserAccountId: actorUserAccountId })
    .where(eq(invoice.invoiceId, invoiceId));
  return version + 1;
}

// Saves every line, as a draft save does, if the page saving them had the
// latest (linesVersion). Returns the lines whose decision was undone because
// they changed, and the new version.
export async function saveEnteredLines(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const content = parseDraftContent(rawInput);
  const version = z.object({ linesVersion: z.number().int().nonnegative() }).safeParse(rawInput);
  if (!version.success) {
    throw new ValidationError({ linesVersion: 'Reload the invoice, then make your change again.' });
  }
  return db.transaction(async (tx) => {
    const { row, chainId } = await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    await requireCurrentLines(tx, row, actorUserAccountId, version.data.linesVersion);
    const before = await lineValues(tx, invoiceId);
    const imported = await findImportForInvoice(tx, invoiceId);
    const fillTimekeepers = !imported || imported.statusCode === CONFIRMED_IMPORT_STATUS_CODE;
    const actor = await resolvePortalActor(tx, actorUserAccountId);
    let total = await replaceLines(tx, actor, invoiceId, row.caseId, row.professionalId, content, fillTimekeepers);
    // As sending does, so the lines are priced now as they will be when frozen.
    if (fillTimekeepers && (await fillUnmatchedTimekeepers(tx, invoiceId, row.professionalId)) > 0) {
      total = await priceLines(tx, invoiceId, { billedProfessionalId: row.professionalId, unmatchedMeansBilled: true, strict: false });
    }
    await tx
      .update(invoice)
      .set({ submittedTotal: total, periodStart: content.periodStart ?? null, periodEnd: content.periodEnd ?? null })
      .where(eq(invoice.invoiceId, invoiceId));
    const after = await lineValues(tx, invoiceId);
    // Only a decided line that changed has a decision to undo.
    const undecided = (await decidedLineIds(tx, chainId)).filter((id) => after.has(id) && before.get(id) !== after.get(id));
    await clearDecisions(tx, chainId, undecided);
    const linesVersion = await markLinesChanged(tx, invoiceId, actorUserAccountId, row.linesVersion);
    return { invoiceId, submittedTotal: total, undecided, linesVersion };
  });
}

export async function setEnteredCaseNumber(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = z.object({ caseNumber: caseNumberInput }).safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return db.transaction(async (tx) => {
    await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    const caseNumber = cleanCaseNumber(parsed.data.caseNumber);
    await tx.update(invoice).set({ caseNumberAsTyped: caseNumber }).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, caseNumber };
  });
}

export async function setEnteredCounty(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const choice = parseCountyChoice(rawInput);
  return db.transaction(async (tx) => {
    await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    const countyId = await resolveCountyChange(tx, actorUserAccountId, choice);
    await tx.update(invoice).set({ countyId }).where(eq(invoice.invoiceId, invoiceId));
    return { invoiceId, county: await shownInvoiceCounty(tx, invoiceId) };
  });
}

// Repricing for a new sender undoes the decision on each line it changes, as
// a line save does, so it carries the page's linesVersion too.
export async function setEnteredSender(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const choice = parseSender(rawInput);
  const version = z.object({ linesVersion: z.number().int().nonnegative() }).safeParse(rawInput);
  if (!version.success) {
    throw new ValidationError({ linesVersion: 'Reload the invoice, then make your change again.' });
  }
  return db.transaction(async (tx) => {
    const { row, chainId } = await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    await requireCurrentLines(tx, row, actorUserAccountId, version.data.linesVersion);
    const before = await lineValues(tx, invoiceId);
    await changeSenderInTx(tx, await resolvePortalActor(tx, actorUserAccountId), row, choice);
    const after = await lineValues(tx, invoiceId);
    const undecided = (await decidedLineIds(tx, chainId)).filter((id) => before.get(id) !== after.get(id));
    await clearDecisions(tx, chainId, undecided);
    const linesVersion = await markLinesChanged(tx, invoiceId, actorUserAccountId, row.linesVersion);
    return { invoiceId, undecided, linesVersion };
  });
}

export async function setEnteredDetails(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const details = parseDetails(rawInput);
  return db.transaction(async (tx) => {
    await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    await setDetailsInTx(tx, invoiceId, details);
    return { invoiceId };
  });
}

// How and when it came in, saved as entered so the entry can be finished later.
export async function setEnteredReceipt(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  const parsed = receiptInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return db.transaction(async (tx) => {
    await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    await recordReceipt(tx, invoiceId, parsed.data);
    return { invoiceId };
  });
}

// Looked up before finishing, outside its transaction, as sending does.
export async function measureEnteredTrips(db: Database, actorUserAccountId: string, invoiceId: string): Promise<void> {
  if (!z.uuid().safeParse(invoiceId).success || !(await entryIsOpen(db, invoiceId))) return;
  const { reviewer } = await loadAssignments(db, invoiceId);
  if (reviewer?.userAccountId !== actorUserAccountId) return;
  const trips = await db
    .select({ tripOrigin: trip.tripOrigin, tripDestination: trip.tripDestination })
    .from(trip)
    // Only mileage is checked against the route.
    .innerJoin(invoiceLine, eq(invoiceLine.tripId, trip.tripId))
    .innerJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
    .where(and(eq(trip.invoiceId, invoiceId), eq(expenseTypes.code, MILEAGE_EXPENSE_TYPE_CODE)));
  await measureTrips(db, trips);
}

// Called by finishing the first round, which has checked the reviewer:
// what sending checks, then the request is frozen.
export async function closeEntry(tx: Transaction, actorUserAccountId: string, invoiceId: string, chainId: string, receipt: ReceiptInput) {
  const before = await lineValues(tx, invoiceId, false);
  await recordReceipt(tx, invoiceId, receipt);
  const [row] = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
  // Filed by person, it is found by its case number; filed under a case, by the case.
  if (!row!.caseId && !row!.caseNumberAsTyped) {
    throw new ValidationError({ caseNumber: 'Add the case number before you finish.' });
  }
  if (!row!.professionalId) {
    throw new ValidationError({ professionalId: 'Choose who this invoice is from before you finish.' });
  }
  const actor = await resolvePortalActor(tx, actorUserAccountId);
  await requireReceiptForStaffEntry(tx, actor, row!);
  await fillUnmatchedTimekeepers(tx, invoiceId, row!.professionalId);
  const imported = await findImportForInvoice(tx, invoiceId);
  if (imported && imported.statusCode !== CONFIRMED_IMPORT_STATUS_CODE) {
    // Finishing confirms them first (confirmEnteredImport).
    throw new InvoiceStateError('The values read from the file could not be checked. Reload the invoice and finish again.');
  }
  await requireImportedDates(tx, invoiceId);
  await freezeRequest(tx, invoiceId, chainId, new Date(), {
    caseId: row!.caseId,
    billedProfessionalId: row!.professionalId!,
    invoiceImportId: imported?.invoiceImportId,
    actorUserAccountId,
  });
  // Entry saves price as freezing does; a decision on a line that still
  // changed was made against other values.
  const after = await lineValues(tx, invoiceId, false);
  if ((await decidedLineIds(tx, chainId)).some((id) => before.get(id) !== after.get(id))) {
    throw new ConflictError('invalid_state', 'Some lines were priced again as the review finished. Reload the invoice and check their decisions.');
  }
}

export class DecisionsUndoneError extends ConflictError {
  constructor(count: number) {
    super(
      'decisions_undone',
      `Before finishing, the lines were checked against the file and matched to who did the work. That changed ${count === 1 ? 'a line you had decided, so its decision was' : `${count} lines you had decided, so their decisions were`} undone. Decide ${count === 1 ? 'it' : 'them'} again, then finish.`,
    );
  }
}

// Before finishing an entry read from a file, its reviewer confirms the
// file's values, which may reprice lines and fill in who did the work, as
// confirming a draft does. Committed on its own: a decided line that changed
// is undecided again, and finishing is refused until it is decided anew.
export async function confirmEnteredImport(db: Database, store: DocumentStore, actorUserAccountId: string, invoiceId: string) {
  if (!z.uuid().safeParse(invoiceId).success || !(await entryIsOpen(db, invoiceId))) return;
  const { storageReference, undone } = await db.transaction(async (tx) => {
    const { row, chainId } = await lockOpenEntry(tx, actorUserAccountId, invoiceId);
    const [imported] = await tx
      .select({
        invoiceImportId: invoiceImport.invoiceImportId,
        statusCode: invoiceImportStatuses.code,
        invoiceId: invoiceImport.invoiceId,
        documentId: invoiceImport.documentId,
      })
      .from(invoiceImport)
      .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
      .where(eq(invoiceImport.invoiceId, invoiceId))
      .for('update', { of: invoiceImport });
    if (!imported || imported.statusCode === CONFIRMED_IMPORT_STATUS_CODE) {
      return { storageReference: undefined, undone: 0 };
    }
    const before = await lineValues(tx, invoiceId);
    const released = await confirmImportInTx(tx, await resolvePortalActor(tx, actorUserAccountId), imported);
    // As an entry save after confirming would.
    if ((await fillUnmatchedTimekeepers(tx, invoiceId, row.professionalId)) > 0) {
      await priceLines(tx, invoiceId, { billedProfessionalId: row.professionalId, unmatchedMeansBilled: true, strict: false });
    }
    const after = await lineValues(tx, invoiceId);
    const changed = (await decidedLineIds(tx, chainId)).filter((id) => before.get(id) !== after.get(id));
    await clearDecisions(tx, chainId, changed);
    if ([...after].some(([id, values]) => before.get(id) !== values)) {
      await markLinesChanged(tx, invoiceId, actorUserAccountId, row.linesVersion);
    }
    return { storageReference: released, undone: changed.length };
  });
  if (storageReference) {
    await store.delete(storageReference);
  }
  if (undone > 0) {
    throw new DecisionsUndoneError(undone);
  }
}

// A wrong upload, before its round is finished and before anyone asked
// about it, may be thrown away by whoever has it.
export async function canDiscardEntry(db: DatabaseOrTransaction, actorUserAccountId: string, invoiceId: string): Promise<boolean> {
  if (!(await entryIsOpen(db, invoiceId))) return false;
  const { reviewer } = await loadAssignments(db, invoiceId);
  const [asked] = await db
    .select({ id: invoiceReviewQuestion.invoiceReviewQuestionId })
    .from(invoiceReviewQuestion)
    .where(eq(invoiceReviewQuestion.invoiceId, invoiceId))
    .limit(1);
  return reviewer?.userAccountId === actorUserAccountId && !asked;
}
