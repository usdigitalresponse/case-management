// Submitter-side payment request transitions (model/workflows.yaml
// payment_request). Each locks the invoice row, as review does, so a recall
// can't race a decision.
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  caseTable,
  document,
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceAttestation,
  invoiceEvent,
  invoiceEventTypes,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  person,
  professional,
  timeEntry,
  userAccount,
} from '../db/schema';
import { authorizeBilling, isStaffAccount, resolvePortalActor, type PortalActor } from '../portal/portalActor';
import { hasUnmatchedTimekeepers, needsMatching, type ProposedCase, type ProposedProvider } from './proposedDetails';
import { importDocumentIds, releaseDocumentIfUnneeded } from '../imports/documentRetention';
import type { DocumentStore } from '../imports/documentStore';
import { formatMoney } from './money';
import { sendEmail } from '../email/sendEmail';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { recordInvoiceEvent } from './invoiceEvents';
import {
  CONFIRMED_IMPORT_STATUS_CODE,
  createTimeEntriesForTimeLines,
  findImportForInvoice,
} from '../imports/importedTimeEntries';
import { recordTimeEntryChange } from '../portal/changeTimeEntry';
import { priceLines } from './priceLines';
import { applyTripDistances, measureTrips } from './routeCheck';
import { checkInferredDates } from '../imports/inferServiceDates';
import { enforceBillingRules } from './billingRules';
import { assignOnSubmit, endAllAssignments } from './reviewAssignment';
import { receiptInputSchema, recordReceipt, requireReceiptForStaffEntry } from './invoiceReceipt';
import {
  AWAITING_MATCH_INVOICE_STATUS_CODE,
  DRAFT_INVOICE_STATUS_CODE,
  SUBMITTED_INVOICE_STATUS_CODE,
  WITHDRAWN_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';
import { optionalEmail } from '../people/emails';

// Snapshot layout version (model/README.md).
export const SUBMISSION_SNAPSHOT_SPEC_VERSION = '0.5.0';

// invoice_line_types codes; 'other' is the pre-existing 'service' type.
// Mileage is an expense line with the mileage expense type.
export const LINE_TYPE_CODES = { time: 'time', expense: 'expense', mileage: 'expense', other: 'service' } as const;
export type LineType = keyof typeof LINE_TYPE_CODES;
export const MILEAGE_EXPENSE_TYPE_CODE = 'mileage';

const address = z.string().trim().min(1).max(300);

export const invoiceLineInputSchema = z
  .object({
    lineType: z.enum(['time', 'expense', 'mileage', 'other']).optional(),
    // Ignored on a time or mileage line, which is priced from rates
    // (./priceLines.ts), except while an import is unconfirmed.
    amount: z.coerce.number().positive().optional(),
    // The billed professionals' time on this case; makes the line a time line.
    sourceTimeEntryId: z.string().uuid().optional(),
    serviceDate: z.iso.date().optional(),
    // Set by import; the client drops it once the date is changed.
    serviceDateInferred: z.boolean().optional(),
    description: z.string().trim().min(1).optional(),
    quantity: z.coerce.number().positive().optional(),
    // Supplier-stated; prices a time line in place of the configured rate.
    unitRate: z.coerce.number().nonnegative().optional(),
    statedAmount: z.coerce.number().nonnegative().optional(),
    timekeeperLabel: z.string().trim().min(1).optional(),
    taskCode: z.string().trim().min(1).optional(),
    activityCode: z.string().trim().min(1).optional(),
    expenseCode: z.string().trim().min(1).optional(),
    // Defaults to the billed professional on a delegated invoice.
    timekeeperProfessionalId: z.string().uuid().optional(),
    // Someone not listed, named by the submitter (./proposedDetails.ts).
    proposedTimekeeperName: z.string().trim().min(1).max(200).optional(),
    proposedTimekeeperEmail: optionalEmail,
    // Mileage only; quantity is the miles claimed for the whole trip.
    tripOrigin: address.optional(),
    tripDestination: address.optional(),
    roundTrip: z.boolean().optional(),
    // The imported file's line or row it was read from; carried back on save.
    sourceLocation: z.string().trim().min(1).max(200).optional(),
  })
  .transform((line) => ({
    ...line,
    lineType: (line.sourceTimeEntryId ? 'time' : (line.lineType ?? 'other')) as LineType,
  }))
  .refine((line) => line.lineType === 'time' || line.lineType === 'mileage' || line.amount !== undefined, {
    message: 'Each expense or other item needs an amount above zero.',
    path: ['amount'],
  });

// A draft may start with no lines, as an invoice entered by hand does;
// submitting needs at least one.
export const draftContentSchema = z.object({
  periodStart: z.iso.date().optional(),
  periodEnd: z.iso.date().optional(),
  lines: z.array(invoiceLineInputSchema),
});

export type DraftContent = z.infer<typeof draftContentSchema>;

export class InvoiceStateError extends ConflictError {
  constructor(message: string) {
    super('invalid_state', message);
  }
}

export function parseDraftContent(rawInput: unknown): DraftContent {
  const parsed = draftContentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const content = parsed.data;
  if (content.periodStart && content.periodEnd && content.periodEnd < content.periodStart) {
    throw new ValidationError({ periodEnd: 'The billing period cannot end before it starts.' });
  }
  return content;
}

// Each line is rounded to cents once, so the total always equals the sum of
// its lines (model/rules.yaml validate_invoice_total).
async function replaceLines(
  tx: Transaction,
  actor: PortalActor,
  invoiceId: string,
  // Null for an invoice held in intake (match_invoice_to_case).
  caseId: string | null,
  // Null: staff will choose the professional when they match it to a case.
  billedProfessionalId: string | null,
  content: DraftContent,
  // Off for an unconfirmed import: unmatched lines stay unmatched.
  fillTimekeepers: boolean,
): Promise<string> {
  const billable = await authorizeBilling(tx, actor, caseId, billedProfessionalId);
  const delegated = billedProfessionalId !== actor.professionalId;
  let lines = content.lines.map((line) => ({
    ...line,
    amount: line.amount === undefined ? undefined : Math.round(line.amount * 100) / 100,
    timekeeperProfessionalId:
      line.timekeeperProfessionalId ??
      (delegated && fillTimekeepers && !line.proposedTimekeeperName ? (billedProfessionalId ?? undefined) : undefined),
  }));
  if (lines.some((line) => line.timekeeperProfessionalId && !billable.has(line.timekeeperProfessionalId))) {
    throw new ValidationError({
      lines: 'Each item must bill a professional you may act for who is assigned to this case.',
    });
  }

  const sourceTimeEntryIds = lines.flatMap((line) => (line.sourceTimeEntryId ? [line.sourceTimeEntryId] : []));
  if (sourceTimeEntryIds.length > 0 && caseId === null) {
    throw new ValidationError({ lines: 'Recorded time belongs to a case. Match the invoice to its case first.' });
  }
  if (sourceTimeEntryIds.length > 0 && caseId !== null) {
    if (new Set(sourceTimeEntryIds).size !== sourceTimeEntryIds.length) {
      throw new ValidationError({ lines: 'The same time entry is on this invoice more than once.' });
    }
    const entries = await tx
      .select()
      .from(timeEntry)
      .where(
        and(
          inArray(timeEntry.timeEntryId, sourceTimeEntryIds),
          inArray(timeEntry.professionalId, [...billable]),
          eq(timeEntry.caseId, caseId),
        ),
      )
      .for('update');
    const byId = new Map(entries.map((entry) => [entry.timeEntryId, entry]));
    if (sourceTimeEntryIds.some((id) => !byId.has(id))) {
      throw new ValidationError({
        lines: 'Some time on this invoice is not time you may bill on this case.',
      });
    }
    const [elsewhere] = await tx
      .select({ timeEntryId: invoiceLine.sourceTimeEntryId })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(
        and(
          inArray(invoiceLine.sourceTimeEntryId, sourceTimeEntryIds),
          ne(invoiceLine.invoiceId, invoiceId),
          ne(invoiceStatuses.code, WITHDRAWN_INVOICE_STATUS_CODE),
        ),
      )
      .limit(1);
    if (elsewhere) {
      const entry = byId.get(elsewhere.timeEntryId as string);
      throw new ValidationError({
        lines: `The time from ${entry?.activityOn} (${entry?.description}) is already on another invoice.`,
      });
    }
    // A linked line shows its entry; editing the line on a draft edits the
    // entry (model/rules.yaml validate_payment_request). An unconfirmed
    // import only links, so the file's values never overwrite recorded time.
    const synced: typeof lines = [];
    for (const line of lines) {
      const entry = line.sourceTimeEntryId ? byId.get(line.sourceTimeEntryId) : undefined;
      if (!entry) {
        synced.push(line);
        continue;
      }
      const next = {
        activityOn: (fillTimekeepers && line.serviceDate) || entry.activityOn,
        durationHours: fillTimekeepers && line.quantity ? line.quantity.toFixed(2) : entry.durationHours,
        description: (fillTimekeepers && line.description) || entry.description,
      };
      if (
        next.activityOn !== entry.activityOn ||
        Number(next.durationHours) !== Number(entry.durationHours) ||
        next.description !== entry.description
      ) {
        // eslint-disable-next-line no-await-in-loop
        await recordTimeEntryChange(tx, actor.userAccountId, 'changed', entry);
        // eslint-disable-next-line no-await-in-loop
        await tx.update(timeEntry).set(next).where(eq(timeEntry.timeEntryId, entry.timeEntryId));
      }
      synced.push({
        ...line,
        serviceDate: next.activityOn,
        quantity: Number(next.durationHours),
        description: next.description,
        // Whose time it is follows the entry.
        timekeeperProfessionalId:
          delegated || entry.professionalId !== billedProfessionalId ? entry.professionalId : undefined,
      });
    }
    lines = synced;
  }

  // Sequential: a transaction's queries share one connection.
  const lineTypeIds = {} as Record<LineType, string>;
  for (const [lineType, code] of Object.entries(LINE_TYPE_CODES) as Array<[LineType, string]>) {
    // eslint-disable-next-line no-await-in-loop
    lineTypeIds[lineType] = await getReferenceId(tx, invoiceLineTypes, code);
  }
  const mileageTypeId = lines.some((line) => line.lineType === 'mileage')
    ? await getReferenceId(tx, expenseTypes, MILEAGE_EXPENSE_TYPE_CODE)
    : undefined;

  // Safe: draft lines have no decisions, and submitted values live on in
  // their attempt's snapshot.
  await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  if (lines.length > 0) await tx.insert(invoiceLine).values(
    lines.map((line) => ({
      invoiceId,
      caseId,
      lineTypeId: lineTypeIds[line.lineType],
      sourceTimeEntryId: line.sourceTimeEntryId,
      // A time line's amount is set by pricing below.
      amount: (line.amount ?? 0).toFixed(2),
      serviceDate: line.serviceDate,
      serviceDateInferred: Boolean(line.serviceDateInferred && line.serviceDate && !line.sourceTimeEntryId),
      description: line.description,
      quantity: line.quantity?.toString(),
      unitRate: line.unitRate?.toFixed(2),
      statedAmount: line.statedAmount?.toFixed(2),
      timekeeperLabel: line.timekeeperLabel,
      // Upper case, as billing codes are kept.
      taskCode: line.taskCode?.toUpperCase(),
      activityCode: line.activityCode,
      expenseCode: line.expenseCode,
      timekeeperProfessionalId: line.timekeeperProfessionalId,
      proposedTimekeeperName: line.proposedTimekeeperName,
      proposedTimekeeperEmail: line.proposedTimekeeperName ? line.proposedTimekeeperEmail : undefined,
      sourceLocation: line.sourceLocation,
      ...(line.lineType === 'mileage' && {
        expenseTypeId: mileageTypeId,
        tripOrigin: line.tripOrigin,
        tripDestination: line.tripDestination,
        roundTrip: Boolean(line.roundTrip),
      }),
    })),
  );
  await applyTripDistances(tx, invoiceId);
  // A draft may be saved incomplete; confirmation and submission are strict.
  return priceLines(tx, invoiceId, {
    billedProfessionalId,
    unmatchedMeansBilled: fillTimekeepers,
    strict: false,
  });
}

async function statusId(tx: Transaction, code: string): Promise<string> {
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
async function lockOwnInvoice(tx: Transaction, actor: PortalActor, invoiceId: string) {
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

async function buildSubmissionSnapshot(
  tx: Transaction,
  invoiceId: string,
  chainId: string,
  capturedAt: Date,
  billingRules: Awaited<ReturnType<typeof enforceBillingRules>>,
) {
  const invoiceRow = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
  const lines = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  const attestations = await tx.select().from(invoiceAttestation).where(eq(invoiceAttestation.invoiceApprovalChainId, chainId));
  return {
    spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
    captured_at: capturedAt.toISOString(),
    invoice_id: invoiceId,
    invoice_approval_chain_id: chainId,
    records: { invoice: invoiceRow, invoice_line: lines, invoice_attestation: attestations },
    billing_rules: billingRules,
  };
}

// What a submitter confirms when sending their own request (model/workflows.yaml
// payment_request configured_attestation). Staff entering a request received
// elsewhere don't attest for its payee.
export const ATTESTATION_STATEMENT = 'I confirm this invoice is true and correct, and the work was done for this case.';

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
    // The submitter ticked ATTESTATION_STATEMENT.
    attested?: boolean;
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
  await checkInferredDates(tx, invoiceId);
  // Only staff may send one to review without a case (match_invoice_to_case).
  if (await needsMatching(tx, locked, { withoutCase: staff && options.withoutCase })) {
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
  await finishSubmission(tx, invoiceId, {
    caseId: locked.caseId,
    billedProfessionalId: locked.professionalId!,
    invoiceImportId: imported?.invoiceImportId,
    attestor,
    attestedAt: new Date(),
    actorUserAccountId: actor.userAccountId,
    eventTypeCode: 'submitted',
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
    billedProfessionalId: locked.professionalId!,
    invoiceImportId: imported?.invoiceImportId,
    attestor,
    attestedAt: sent?.occurredAt ?? new Date(),
    actorUserAccountId: staffUserAccountId,
    eventTypeCode: 'released_to_review',
  });
  return true;
}

async function finishSubmission(
  tx: Transaction,
  invoiceId: string,
  args: {
    caseId: string | null;
    billedProfessionalId: string;
    invoiceImportId: string | undefined;
    attestor: string | null;
    attestedAt: Date;
    actorUserAccountId: string;
    eventTypeCode: 'submitted' | 'released_to_review';
  },
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
  // Priced again so the snapshot below freezes the rates in force.
  await priceLines(tx, invoiceId, {
    billedProfessionalId,
    unmatchedMeansBilled: true,
    strict: true,
  });
  // Callers measure trips first, outside the transaction.
  await applyTripDistances(tx, invoiceId);
  const billingRules = await enforceBillingRules(tx, invoiceId);

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
      statement: ATTESTATION_STATEMENT,
    });
  }
  await tx
    .update(invoiceApprovalChain)
    .set({
      submissionSnapshot: await buildSubmissionSnapshot(tx, invoiceId, invoiceApprovalChainId, submittedAt, billingRules),
    })
    .where(eq(invoiceApprovalChain.invoiceApprovalChainId, invoiceApprovalChainId));
  await recordInvoiceEvent(tx, {
    invoiceId,
    eventTypeCode: args.eventTypeCode,
    statusId: submittedStatusId,
    actorUserAccountId: args.actorUserAccountId,
    chainId: invoiceApprovalChainId,
  });
  await assignOnSubmit(tx, invoiceId, caseId);
}

export async function updateDraftInvoice(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const content = parseDraftContent(rawInput);
  return db.transaction(async (tx) => {
    const { locked } = await lockOwnInvoice(tx, actor, invoiceId);
    if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
      throw new InvoiceStateError('Only a draft can be edited.');
    }
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

// Staff entering a request received elsewhere pass how and when it came in,
// and whether to review it without a case; a submitter sending their own
// passes `attested`, and is emailed a receipt.
export async function submitInvoice(db: Database, actor: PortalActor, invoiceId: string, rawReceipt: unknown = {}) {
  const receipt = receiptInputSchema
    .extend({ withoutCase: z.boolean().optional(), attested: z.boolean().optional() })
    .safeParse(rawReceipt ?? {});
  if (!receipt.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(receipt.error.issues));
  }
  if (z.uuid().safeParse(invoiceId).success) {
    const trips = await db
      .select({ tripOrigin: invoiceLine.tripOrigin, tripDestination: invoiceLine.tripDestination })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
      .where(and(eq(invoiceLine.invoiceId, invoiceId), eq(invoice.submittedByUserAccountId, actor.userAccountId)));
    await measureTrips(db, trips);
  }
  const status = await db.transaction(async (tx) => {
    // The receipt is recorded only on an invoice this actor may submit; submitInTx locks it again.
    await lockOwnInvoice(tx, actor, invoiceId);
    await recordReceipt(tx, invoiceId, receipt.data);
    return submitInTx(tx, actor, invoiceId, { withoutCase: receipt.data.withoutCase, attested: receipt.data.attested });
  });
  if (!(await isStaffAccount(db, actor.userAccountId))) {
    // Not awaited: sending is a courtesy; a failure is logged, never shown.
    emailReceipt(db, actor, invoiceId, status).catch((error: unknown) => {
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
    `Case: ${[row.caseReference, row.clientName].filter(Boolean).join(', ') || 'not given'}`,
    `Billing period: ${row.periodStart && row.periodEnd ? `${row.periodStart} to ${row.periodEnd}` : 'not given'}`,
    `Amount: ${formatMoney(row.submittedTotal)}`,
    `Sent: ${(row.submittedAt ?? new Date()).toISOString()}`,
    '',
    'You can withdraw it until review starts. Reviewers see your original file and every change you made.',
  ];
  await sendEmail(row.email, status === 'awaiting_match' ? 'Invoice received' : 'Invoice sent for review', lines.join('\n'));
}

// Only before any decision. The recalled chain is superseded, keeping its
// snapshot. One waiting to be matched has no chain yet.
export async function recallInvoice(db: Database, actor: PortalActor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const { locked } = await lockOwnInvoice(tx, actor, invoiceId);
    const recallable = [await statusId(tx, SUBMITTED_INVOICE_STATUS_CODE), await statusId(tx, AWAITING_MATCH_INVOICE_STATUS_CODE)];
    if (!recallable.includes(locked.statusId)) {
      throw new InvoiceStateError('Only a submitted invoice can be recalled.');
    }
    const [chain] = await tx
      .select({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId })
      .from(invoiceApprovalChain)
      .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
    if (chain) {
      const [decision] = await tx
        .select({ id: invoiceApprovalDecision.invoiceApprovalDecisionId })
        .from(invoiceApprovalDecision)
        .where(eq(invoiceApprovalDecision.invoiceApprovalChainId, chain.invoiceApprovalChainId))
        .limit(1);
      if (decision) {
        throw new InvoiceStateError('Review has started, so this invoice can no longer be recalled.');
      }
      await tx
        .update(invoiceApprovalChain)
        .set({ supersededAt: new Date() })
        .where(eq(invoiceApprovalChain.invoiceApprovalChainId, chain.invoiceApprovalChainId));
    }
    await endAllAssignments(tx, invoiceId, actor.userAccountId);
    const draftStatusId = await statusId(tx, DRAFT_INVOICE_STATUS_CODE);
    await tx.update(invoice).set({ statusId: draftStatusId, submittedAt: null }).where(eq(invoice.invoiceId, invoiceId));
    await recordInvoiceEvent(tx, {
      invoiceId,
      eventTypeCode: 'recalled',
      statusId: draftStatusId,
      actorUserAccountId: actor.userAccountId,
      chainId: chain?.invoiceApprovalChainId,
    });
    return { invoiceId };
  });
}

export async function withdrawInvoice(db: Database, store: DocumentStore, actor: PortalActor, invoiceId: string) {
  const files = await db.transaction(async (tx) => {
    const { locked } = await lockOwnInvoice(tx, actor, invoiceId);
    if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
      throw new InvoiceStateError('Only a draft can be withdrawn; recall a submitted invoice first.');
    }
    const imported = await findImportForInvoice(tx, invoiceId);
    if (imported && imported.statusCode !== CONFIRMED_IMPORT_STATUS_CODE) {
      throw new InvoiceStateError('Discard the import instead; that also deletes the uploaded file.');
    }
    await withdrawDraftInTx(tx, invoiceId, { actorUserAccountId: actor.userAccountId });
    const released: string[] = [];
    for (const documentId of await importDocumentIds(tx, invoiceId)) {
      // eslint-disable-next-line no-await-in-loop
      await tx.select({ documentId: document.documentId }).from(document).where(eq(document.documentId, documentId)).for('update');
      // eslint-disable-next-line no-await-in-loop
      const storageReference = await releaseDocumentIfUnneeded(tx, documentId);
      if (storageReference) released.push(storageReference);
    }
    return released;
  });
  // After commit; the hourly sweep retries any that fail.
  for (const storageReference of files) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(storageReference);
  }
  return { invoiceId };
}

// Caller holds the row lock and has checked it's a draft. A system action
// (import expiry) gives a reason instead of an actor.
export async function withdrawDraftInTx(
  tx: Transaction,
  invoiceId: string,
  by: { actorUserAccountId: string } | { actorUserAccountId: null; reason: string },
): Promise<void> {
  const withdrawnStatusId = await statusId(tx, WITHDRAWN_INVOICE_STATUS_CODE);
  await tx.update(invoice).set({ statusId: withdrawnStatusId }).where(eq(invoice.invoiceId, invoiceId));
  await recordInvoiceEvent(tx, { invoiceId, eventTypeCode: 'withdrawn', statusId: withdrawnStatusId, ...by });
}
