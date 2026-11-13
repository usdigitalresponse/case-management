import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { type Database, type Transaction } from '../../db/client';
import { firstRow } from '../../db/rowHelpers';
import { ValidationError } from '../../errors';
import { fieldErrorsFromZodIssues } from '../../intake/validation';
import { caseTable, expenseTypes, invoice, invoiceApprovalChain, invoiceAttestation, invoiceEvent, invoiceEventTypes, invoiceLine, person, professional, trip, userAccount } from '../../db/schema';
import { isStaffAccount, resolvePortalActor, type PortalActor } from '../../portal/portalActor';
import { hasUnmatchedTimekeepers, needsMatching, requireCaseAnswered, requireNotForCaseCounty } from '../proposedDetails';
import { formatMoney } from '../money';
import { sendEmail } from '../../email/sendEmail';
import { recordInvoiceEvent } from '../invoiceEvents';
import { CONFIRMED_IMPORT_STATUS_CODE, createTimeEntriesForTimeLines, findImportForInvoice } from '../../imports/importedTimeEntries';
import { priceLines } from '../priceLines';
import { applyTripDistances, measureTrips } from '../routeCheck';
import { requireImportedDates } from '../../imports/undatedLines';
import { enforceBillingRules } from '../billingRules';
import { assignOnSubmit } from '../reviewAssignment';
import { receiptInputSchema, recordReceipt, requireReceiptForStaffEntry } from '../invoiceReceipt';
import { fillUnmatchedTimekeepers } from '../timekeeperFallback';
import { AWAITING_MATCH_INVOICE_STATUS_CODE, DRAFT_INVOICE_STATUS_CODE, SUBMITTED_INVOICE_STATUS_CODE } from '../invoiceStatusCodes';
import { requireOverrunExplanation } from '../overrunExplanation';
import { formatCalendarDate, formatInstant } from '../../formatDate';
import { InvoiceStateError, MILEAGE_EXPENSE_TYPE_CODE } from './lineInput';
import { lockOwnInvoice, statusId } from './drafts';

// Snapshot layout version (model/README.md).
export const SUBMISSION_SNAPSHOT_SPEC_VERSION = '0.15.0';

async function buildSubmissionSnapshot(
  tx: Transaction,
  invoiceId: string,
  chainId: string,
  capturedAt: Date,
  billingRules: Awaited<ReturnType<typeof enforceBillingRules>>,
) {
  const invoiceRow = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
  const lines = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  const trips = await tx.select().from(trip).where(eq(trip.invoiceId, invoiceId));
  const attestations = await tx.select().from(invoiceAttestation).where(eq(invoiceAttestation.invoiceApprovalChainId, chainId));
  return {
    spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
    captured_at: capturedAt.toISOString(),
    invoice_id: invoiceId,
    invoice_approval_chain_id: chainId,
    records: { invoice: invoiceRow, invoice_line: lines, trip: trips, invoice_attestation: attestations },
    billing_rules: billingRules,
  };
}

// What a submitter confirms when sending their own request (model/workflows.yaml
// payment_request configured_attestation). Staff entering a request received
// elsewhere don't attest for its payee.
export const ATTESTATION_STATEMENT = 'I confirm this invoice is true and correct, and the work was done for this case.';

// Filed by person, it names the typed case number.
export function attestationStatement(caseNumberAsTyped: string | null): string {
  return caseNumberAsTyped
    ? `I confirm this invoice is true and correct, and the work was done for case ${caseNumberAsTyped}.`
    : ATTESTATION_STATEMENT;
}

// The attestor is the submitter as a person: their account's person, or
// their professional profile's.
async function attestorPersonId(tx: Transaction, actor: PortalActor): Promise<string | null> {
  const [account] = await tx
    .select({ personId: userAccount.personId })
    .from(userAccount)
    .where(eq(userAccount.userAccountId, actor.userAccountId));
  if (account?.personId) {
    return account.personId;
  }
  if (!actor.professionalId) {
    return null;
  }
  const [own] = await tx
    .select({ personId: professional.personId })
    .from(professional)
    .where(eq(professional.professionalId, actor.professionalId));
  return own?.personId ?? null;
}

// Sends a draft: to review, or, while its case, provider or a line's
// timekeeper is still unknown, to intake for matching (send_for_matching).
export async function submitInTx(
  tx: Transaction,
  actor: PortalActor,
  invoiceId: string,
  options: {
    // Staff chose to review it with no case (match_invoice_to_case).
    withoutCase?: boolean;
    // The submitter ticked attestationStatement().
    attested?: boolean;
    // Filed under its sender with a typed case number: needs both, and goes
    // to review without a case.
    filedByPerson?: boolean;
    overrunExplanation?: string;
  } = {},
): Promise<'submitted' | 'awaiting_match'> {
  const staff = await isStaffAccount(tx, actor.userAccountId);
  if (!staff && !options.attested) {
    throw new ValidationError({ attested: 'Tick the box to confirm this invoice is true and correct.' });
  }
  const attestor = staff ? null : await attestorPersonId(tx, actor);
  if (!staff && !attestor) {
    throw new ValidationError({ attested: 'Your account has no person record to attest with. Ask the billing office.' });
  }
  const { locked, billable } = await lockOwnInvoice(tx, actor, invoiceId);
  if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
    throw new InvoiceStateError('Only a draft can be submitted.');
  }
  if (options.filedByPerson) {
    // External submitters may leave the case question unanswered (match_invoice_to_case).
    if (staff) {
      requireCaseAnswered(locked);
    } else {
      requireNotForCaseCounty(locked);
    }
    if (!locked.professionalId) {
      throw new ValidationError({ professionalId: 'Choose who this invoice is from before you send.' });
    }
    await fillUnmatchedTimekeepers(tx, invoiceId, locked.professionalId);
  }
  await requireReceiptForStaffEntry(tx, actor, locked);
  const lines = await tx
    .select({ timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));
  if (lines.length === 0) {
    throw new ValidationError({ lines: 'Add at least one invoice item before submitting.' });
  }
  // Rechecked: a timekeeper may have left the office or case since saving.
  if (lines.some((line) => line.timekeeperProfessionalId && !billable.has(line.timekeeperProfessionalId))) {
    throw new ValidationError({
      lines: 'An item bills a professional you can no longer act for on this case. Edit the draft first.',
    });
  }
  const imported = await findImportForInvoice(tx, invoiceId);
  if (imported && imported.statusCode !== CONFIRMED_IMPORT_STATUS_CODE) {
    throw new InvoiceStateError('Confirm the imported values before submitting this invoice.');
  }
  await requireImportedDates(tx, invoiceId);
  // Only staff may send one to review without a case (match_invoice_to_case).
  if (await needsMatching(tx, locked, { withoutCase: staff && options.withoutCase, filedByPerson: options.filedByPerson })) {
    // What can be checked before matching is checked now, for the submitter.
    if (locked.professionalId !== null && !(await hasUnmatchedTimekeepers(tx, invoiceId))) {
      await priceLines(tx, invoiceId, { billedProfessionalId: locked.professionalId, unmatchedMeansBilled: true, strict: true });
    }
    const awaitingStatusId = await statusId(tx, AWAITING_MATCH_INVOICE_STATUS_CODE);
    await tx.update(invoice).set({ statusId: awaitingStatusId }).where(eq(invoice.invoiceId, invoiceId));
    await recordInvoiceEvent(tx, {
      invoiceId,
      eventTypeCode: 'sent_for_matching',
      statusId: awaitingStatusId,
      actorUserAccountId: actor.userAccountId,
    });
    return 'awaiting_match';
  }
  const chainId = await finishSubmission(tx, invoiceId, {
    caseId: locked.caseId,
    caseNumberAsTyped: locked.caseNumberAsTyped,
    billedProfessionalId: locked.professionalId!,
    invoiceImportId: imported?.invoiceImportId,
    attestor,
    attestedAt: new Date(),
    actorUserAccountId: actor.userAccountId,
    eventTypeCode: 'submitted',
  });
  await requireOverrunExplanation(tx, {
    invoiceId,
    chainId,
    actorUserAccountId: actor.userAccountId,
    explanation: options.overrunExplanation,
    required: !staff,
  });
  return 'submitted';
}

// Staff have matched everything a request sent for matching was missing
// (release_to_review): it goes on as if just submitted, with the attestation
// given on sending. Returns false while something is still unmatched.
export async function releaseToReviewInTx(tx: Transaction, staffUserAccountId: string, invoiceId: string): Promise<boolean> {
  const [locked] = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId)).for('update');
  if (!locked || locked.statusId !== (await statusId(tx, AWAITING_MATCH_INVOICE_STATUS_CODE))) {
    throw new InvoiceStateError('Only an invoice waiting for its case can be released to review.');
  }
  if (await needsMatching(tx, locked)) {
    return false;
  }
  const [sent] = await tx
    .select({ occurredAt: invoiceEvent.occurredAt })
    .from(invoiceEvent)
    .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
    .where(and(eq(invoiceEvent.invoiceId, invoiceId), eq(invoiceEventTypes.code, 'sent_for_matching')))
    .orderBy(desc(invoiceEvent.occurredAt))
    .limit(1);
  const submitter = await resolvePortalActor(tx, locked.submittedByUserAccountId);
  const attestor = (await isStaffAccount(tx, submitter.userAccountId)) ? null : await attestorPersonId(tx, submitter);
  const imported = await findImportForInvoice(tx, invoiceId);
  await finishSubmission(tx, invoiceId, {
    caseId: locked.caseId,
    caseNumberAsTyped: locked.caseNumberAsTyped,
    billedProfessionalId: locked.professionalId!,
    invoiceImportId: imported?.invoiceImportId,
    attestor,
    attestedAt: sent?.occurredAt ?? new Date(),
    actorUserAccountId: staffUserAccountId,
    eventTypeCode: 'released_to_review',
  });
  return true;
}

// Prices the lines for good, checks the billing rules and freezes what was
// asked for in the attempt's snapshot. Callers measure trips first, outside
// the transaction.
export async function freezeRequest(
  tx: Transaction,
  invoiceId: string,
  chainId: string,
  capturedAt: Date,
  args: { caseId: string | null; billedProfessionalId: string; invoiceImportId: string | undefined; actorUserAccountId: string },
): Promise<void> {
  const { caseId, billedProfessionalId } = args;
  // Time is recorded against a case; with none, time lines stand alone.
  if (caseId !== null) {
    await createTimeEntriesForTimeLines(
      tx,
      { invoiceId, caseId, billedProfessionalId, invoiceImportId: args.invoiceImportId },
      args.actorUserAccountId,
    );
  }
  await priceLines(tx, invoiceId, { billedProfessionalId, unmatchedMeansBilled: true, strict: true });
  await applyTripDistances(tx, invoiceId);
  const billingRules = await enforceBillingRules(tx, invoiceId);
  await tx
    .update(invoiceApprovalChain)
    .set({ submissionSnapshot: await buildSubmissionSnapshot(tx, invoiceId, chainId, capturedAt, billingRules) })
    .where(eq(invoiceApprovalChain.invoiceApprovalChainId, chainId));
}

async function finishSubmission(
  tx: Transaction,
  invoiceId: string,
  args: {
    caseId: string | null;
    caseNumberAsTyped: string | null;
    billedProfessionalId: string;
    invoiceImportId: string | undefined;
    attestor: string | null;
    attestedAt: Date;
    actorUserAccountId: string;
    eventTypeCode: 'submitted' | 'released_to_review';
  },
): Promise<string> {
  const { caseId, billedProfessionalId } = args;
  const submittedAt = new Date();
  const submittedStatusId = await statusId(tx, SUBMITTED_INVOICE_STATUS_CODE);
  await tx.update(invoice).set({ statusId: submittedStatusId, submittedAt }).where(eq(invoice.invoiceId, invoiceId));
  const { invoiceApprovalChainId } = firstRow(
    await tx
      .insert(invoiceApprovalChain)
      .values({ invoiceId, createdByUserAccountId: args.actorUserAccountId, createdAt: submittedAt })
      .returning({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId }),
  );
  if (args.attestor) {
    await tx.insert(invoiceAttestation).values({
      invoiceApprovalChainId,
      attestorPersonId: args.attestor,
      recordedByUserAccountId: args.actorUserAccountId,
      attestedAt: args.attestedAt,
      statement: attestationStatement(args.caseNumberAsTyped),
    });
  }
  await freezeRequest(tx, invoiceId, invoiceApprovalChainId, submittedAt, args);
  await recordInvoiceEvent(tx, {
    invoiceId,
    eventTypeCode: args.eventTypeCode,
    statusId: submittedStatusId,
    actorUserAccountId: args.actorUserAccountId,
    chainId: invoiceApprovalChainId,
  });
  await assignOnSubmit(tx, invoiceId, caseId, billedProfessionalId);
  return invoiceApprovalChainId;
}

// Staff entering a request received elsewhere pass how and when it came in,
// and whether to review it without a case; a submitter sending their own
// passes `attested`, and is emailed a receipt.
export async function submitInvoice(db: Database, actor: PortalActor, invoiceId: string, rawReceipt: unknown = {}) {
  const receipt = receiptInputSchema
    .extend({
      withoutCase: z.boolean().optional(),
      attested: z.boolean().optional(),
      filedByPerson: z.boolean().optional(),
      overrunExplanation: z.string().max(4000).optional(),
      // The sender's browser zone, for the receipt's time.
      timeZone: z.string().max(64).optional(),
    })
    .safeParse(rawReceipt ?? {});
  if (!receipt.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(receipt.error.issues));
  }
  if (z.uuid().safeParse(invoiceId).success) {
    const trips = await db
      .select({ tripOrigin: trip.tripOrigin, tripDestination: trip.tripDestination })
      .from(trip)
      .innerJoin(invoice, eq(trip.invoiceId, invoice.invoiceId))
      // Only mileage is checked against the route.
      .innerJoin(invoiceLine, eq(invoiceLine.tripId, trip.tripId))
      .innerJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
      .where(
        and(
          eq(trip.invoiceId, invoiceId),
          eq(invoice.submittedByUserAccountId, actor.userAccountId),
          eq(expenseTypes.code, MILEAGE_EXPENSE_TYPE_CODE),
        ),
      );
    await measureTrips(db, trips);
  }
  const status = await db.transaction(async (tx) => {
    // The receipt is recorded only on an invoice this actor may submit; submitInTx locks it again.
    await lockOwnInvoice(tx, actor, invoiceId);
    await recordReceipt(tx, invoiceId, receipt.data);
    return submitInTx(tx, actor, invoiceId, {
      withoutCase: receipt.data.withoutCase,
      attested: receipt.data.attested,
      filedByPerson: receipt.data.filedByPerson,
      overrunExplanation: receipt.data.overrunExplanation,
    });
  });
  if (!(await isStaffAccount(db, actor.userAccountId))) {
    // Not awaited: sending is a courtesy; a failure is logged, never shown.
    emailReceipt(db, actor, invoiceId, status, receipt.data.timeZone).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Failed to email an invoice receipt:', error);
    });
  }
  return { invoiceId, status };
}

async function emailReceipt(
  db: Database,
  actor: PortalActor,
  invoiceId: string,
  status: 'submitted' | 'awaiting_match',
  timeZone: string | undefined,
): Promise<void> {
  const [row] = await db
    .select({
      email: userAccount.email,
      submittedAt: invoice.submittedAt,
      submittedTotal: invoice.submittedTotal,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      caseReference: caseTable.externalReference,
      clientName: person.displayName,
      caseNumberAsTyped: invoice.caseNumberAsTyped,
    })
    .from(invoice)
    .innerJoin(userAccount, eq(userAccount.userAccountId, actor.userAccountId))
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row?.email) {
    return;
  }
  const lines = [
    status === 'awaiting_match'
      ? 'We received your invoice. Some of its details aren’t in our system yet, so the billing office will match them, then send it for review.'
      : 'We received your invoice and sent it for review.',
    '',
    row.caseNumberAsTyped
      ? `Case number: ${row.caseNumberAsTyped}`
      : `Case: ${[row.caseReference, row.clientName].filter(Boolean).join(', ') || 'not given'}`,
    `Billing period: ${row.periodStart && row.periodEnd ? `${formatCalendarDate(row.periodStart)} to ${formatCalendarDate(row.periodEnd)}` : 'not given'}`,
    `Amount: ${formatMoney(row.submittedTotal)}`,
    `Sent: ${formatInstant(row.submittedAt ?? new Date(), timeZone)}`,
    '',
    'You can withdraw it until review starts. Reviewers see your original file and every change you made.',
  ];
  await sendEmail(row.email, status === 'awaiting_match' ? 'Invoice received' : 'Invoice sent for review', lines.join('\n'));
}
