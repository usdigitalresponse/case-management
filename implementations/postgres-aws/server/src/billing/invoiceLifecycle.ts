// Submitter-side payment request transitions (model/workflows.yaml
// payment_request). Each locks the invoice row, as review does, so a recall
// can't race a decision.
import { z } from 'zod';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  timeEntry,
} from '../db/schema';
import { authorizeBilling, type PortalActor } from '../portal/portalActor';
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
  DRAFT_INVOICE_STATUS_CODE,
  SUBMITTED_INVOICE_STATUS_CODE,
  WITHDRAWN_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';

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
    // Mileage only; quantity is the miles claimed for the whole trip.
    tripOrigin: address.optional(),
    tripDestination: address.optional(),
    roundTrip: z.boolean().optional(),
  })
  .transform((line) => ({
    ...line,
    lineType: (line.sourceTimeEntryId ? 'time' : (line.lineType ?? 'other')) as LineType,
  }))
  .refine((line) => line.lineType === 'time' || line.lineType === 'mileage' || line.amount !== undefined, {
    message: 'Each expense or other item needs an amount above zero.',
    path: ['amount'],
  });

export const draftContentSchema = z.object({
  periodStart: z.iso.date().optional(),
  periodEnd: z.iso.date().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
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
      line.timekeeperProfessionalId ?? (delegated && fillTimekeepers ? (billedProfessionalId ?? undefined) : undefined),
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
  await tx.insert(invoiceLine).values(
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
  options: { fillTimekeepers: boolean } = { fillTimekeepers: true },
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
      })
      .returning({ invoiceId: invoice.invoiceId }),
  );
  const total = await replaceLines(tx, actor, invoiceId, caseId, billedProfessionalId, content, options.fillTimekeepers);
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
  return {
    spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
    captured_at: capturedAt.toISOString(),
    invoice_id: invoiceId,
    invoice_approval_chain_id: chainId,
    records: { invoice: invoiceRow, invoice_line: lines },
    billing_rules: billingRules,
  };
}

export async function submitInTx(
  tx: Transaction,
  actor: PortalActor,
  invoiceId: string,
  // Staff chose to review an invoice with no case (match_invoice_to_case).
  options: { withoutCase?: boolean } = {},
): Promise<void> {
  const { locked, billable } = await lockOwnInvoice(tx, actor, invoiceId);
  if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
    throw new InvoiceStateError('Only a draft can be submitted.');
  }
  if (locked.professionalId === null) {
    throw new ValidationError({ professionalId: 'Choose who this invoice is from when you match it to a case.' });
  }
  if (locked.caseId === null && !options.withoutCase) {
    throw new ValidationError({ caseId: 'Match this invoice to a case, or choose to review it without one.' });
  }
  const billedProfessionalId = locked.professionalId;
  await requireReceiptForStaffEntry(tx, actor, { ...locked, professionalId: billedProfessionalId });
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
  // Time is recorded against a case; with none, time lines stand alone.
  if (locked.caseId !== null) {
    await createTimeEntriesForTimeLines(
      tx,
      {
        invoiceId,
        caseId: locked.caseId,
        billedProfessionalId,
        invoiceImportId: imported?.invoiceImportId,
      },
      actor.userAccountId,
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
      .values({ invoiceId, createdByUserAccountId: actor.userAccountId, createdAt: submittedAt })
      .returning({ invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId }),
  );
  await tx
    .update(invoiceApprovalChain)
    .set({
      submissionSnapshot: await buildSubmissionSnapshot(tx, invoiceId, invoiceApprovalChainId, submittedAt, billingRules),
    })
    .where(eq(invoiceApprovalChain.invoiceApprovalChainId, invoiceApprovalChainId));
  await recordInvoiceEvent(tx, {
    invoiceId,
    eventTypeCode: 'submitted',
    statusId: submittedStatusId,
    actorUserAccountId: actor.userAccountId,
    chainId: invoiceApprovalChainId,
  });
  await assignOnSubmit(tx, invoiceId, locked.caseId);
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
// and whether to review it without a case.
export async function submitInvoice(db: Database, actor: PortalActor, invoiceId: string, rawReceipt: unknown = {}) {
  const receipt = receiptInputSchema.extend({ withoutCase: z.boolean().optional() }).safeParse(rawReceipt ?? {});
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
  await db.transaction(async (tx) => {
    // The receipt is recorded only on an invoice this actor may submit; submitInTx locks it again.
    await lockOwnInvoice(tx, actor, invoiceId);
    await recordReceipt(tx, invoiceId, receipt.data);
    await submitInTx(tx, actor, invoiceId, { withoutCase: receipt.data.withoutCase });
  });
  return { invoiceId };
}

// Only before any decision. The recalled chain is superseded, keeping its
// snapshot.
export async function recallInvoice(db: Database, actor: PortalActor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const { locked } = await lockOwnInvoice(tx, actor, invoiceId);
    if (locked.statusId !== (await statusId(tx, SUBMITTED_INVOICE_STATUS_CODE))) {
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

export async function withdrawInvoice(db: Database, actor: PortalActor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const { locked } = await lockOwnInvoice(tx, actor, invoiceId);
    if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
      throw new InvoiceStateError('Only a draft can be withdrawn; recall a submitted invoice first.');
    }
    const imported = await findImportForInvoice(tx, invoiceId);
    if (imported && imported.statusCode !== CONFIRMED_IMPORT_STATUS_CODE) {
      throw new InvoiceStateError('Discard the import instead; that also deletes the uploaded file.');
    }
    await withdrawDraftInTx(tx, invoiceId, { actorUserAccountId: actor.userAccountId });
    return { invoiceId };
  });
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
