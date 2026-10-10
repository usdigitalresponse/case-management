// Submitter-side payment request transitions (model/workflows.yaml
// payment_request). Each locks the invoice row, as review does, so a recall
// can't race a decision.
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { firstRow } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ConflictError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import {
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  timeEntry,
} from '../db/schema';
import { NotAssignedToCaseError } from '../portal/caseAssignmentAuthorization';
import { billableProfessionalIds, type PortalActor } from '../portal/portalActor';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { recordInvoiceEvent } from './invoiceEvents';
import {
  CONFIRMED_IMPORT_STATUS_CODE,
  createTimeEntriesFromImportedLines,
  findImportForInvoice,
} from '../imports/importedTimeEntries';
import {
  DRAFT_INVOICE_STATUS_CODE,
  SUBMITTED_INVOICE_STATUS_CODE,
  WITHDRAWN_INVOICE_STATUS_CODE,
} from './invoiceStatusCodes';

// Snapshot layout version (model/README.md).
export const SUBMISSION_SNAPSHOT_SPEC_VERSION = '0.3.0';

// invoice_line_types codes; 'other' is the pre-existing 'service' type.
export const LINE_TYPE_CODES = { time: 'time', expense: 'expense', other: 'service' } as const;
export type LineType = keyof typeof LINE_TYPE_CODES;

export const invoiceLineInputSchema = z.object({
  lineType: z.enum(['time', 'expense', 'other']).default('other'),
  amount: z.coerce.number().positive(),
  // Context only; must be the billed professionals' time on this case.
  sourceTimeEntryId: z.string().uuid().optional(),
  // Supplier-stated evidence; never used to compute the amount.
  serviceDate: z.iso.date().optional(),
  description: z.string().trim().min(1).optional(),
  quantity: z.coerce.number().positive().optional(),
  unitRate: z.coerce.number().nonnegative().optional(),
  timekeeperLabel: z.string().trim().min(1).optional(),
  taskCode: z.string().trim().min(1).optional(),
  activityCode: z.string().trim().min(1).optional(),
  expenseCode: z.string().trim().min(1).optional(),
  // Defaults to the billed professional on a delegated invoice.
  timekeeperProfessionalId: z.string().uuid().optional(),
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
  caseId: string,
  billedProfessionalId: string,
  content: DraftContent,
  // Off for an unconfirmed import: unmatched lines stay unmatched.
  fillTimekeepers: boolean,
): Promise<string> {
  const billable = new Set(await billableProfessionalIds(tx, actor, caseId));
  if (!billable.has(billedProfessionalId)) {
    throw new NotAssignedToCaseError();
  }
  const delegated = billedProfessionalId !== actor.professionalId;
  const lines = content.lines.map((line) => ({
    ...line,
    amount: Math.round(line.amount * 100) / 100,
    timekeeperProfessionalId:
      line.timekeeperProfessionalId ?? (delegated && fillTimekeepers ? billedProfessionalId : undefined),
  }));
  if (lines.some((line) => line.timekeeperProfessionalId && !billable.has(line.timekeeperProfessionalId))) {
    throw new ValidationError({
      lines: 'Each item must bill a professional you may act for who is assigned to this case.',
    });
  }

  const sourceTimeEntryIds = lines.flatMap((line) => (line.sourceTimeEntryId ? [line.sourceTimeEntryId] : []));
  if (sourceTimeEntryIds.length > 0) {
    const allowedProfessionalIds = [
      billedProfessionalId,
      ...lines.flatMap((line) => (line.timekeeperProfessionalId ? [line.timekeeperProfessionalId] : [])),
    ];
    const owned = await tx
      .select({ timeEntryId: timeEntry.timeEntryId })
      .from(timeEntry)
      .where(
        and(
          inArray(timeEntry.timeEntryId, sourceTimeEntryIds),
          inArray(timeEntry.professionalId, allowedProfessionalIds),
          eq(timeEntry.caseId, caseId),
        ),
      );
    const ownedIds = new Set(owned.map((row) => row.timeEntryId));
    if (sourceTimeEntryIds.some((id) => !ownedIds.has(id))) {
      throw new ValidationError({
        lines: 'One or more sourceTimeEntryId values are not time entries on this case for the billed professionals.',
      });
    }
  }

  // Sequential: a transaction's queries share one connection.
  const lineTypeIds = {} as Record<LineType, string>;
  for (const [lineType, code] of Object.entries(LINE_TYPE_CODES) as Array<[LineType, string]>) {
    // eslint-disable-next-line no-await-in-loop
    lineTypeIds[lineType] = await getReferenceId(tx, invoiceLineTypes, code);
  }

  // Safe: draft lines have no decisions, and submitted values live on in
  // their attempt's snapshot.
  await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  await tx.insert(invoiceLine).values(
    lines.map((line) => ({
      invoiceId,
      caseId,
      lineTypeId: lineTypeIds[line.lineType],
      sourceTimeEntryId: line.sourceTimeEntryId,
      amount: line.amount.toFixed(2),
      serviceDate: line.serviceDate,
      description: line.description,
      quantity: line.quantity?.toString(),
      unitRate: line.unitRate?.toFixed(2),
      timekeeperLabel: line.timekeeperLabel,
      taskCode: line.taskCode,
      activityCode: line.activityCode,
      expenseCode: line.expenseCode,
      timekeeperProfessionalId: line.timekeeperProfessionalId,
    })),
  );
  return lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2);
}

async function statusId(tx: Transaction, code: string): Promise<string> {
  return getReferenceId(tx, invoiceStatuses, code);
}

export async function createDraftInTx(
  tx: Transaction,
  actor: PortalActor,
  caseId: string,
  billedProfessionalId: string,
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
  if (!(await billableProfessionalIds(tx, actor, locked.caseId)).includes(locked.professionalId)) {
    throw new NotAssignedToCaseError();
  }
  return locked;
}

async function buildSubmissionSnapshot(tx: Transaction, invoiceId: string, chainId: string, capturedAt: Date) {
  const invoiceRow = await tx.select().from(invoice).where(eq(invoice.invoiceId, invoiceId));
  const lines = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  return {
    spec_version: SUBMISSION_SNAPSHOT_SPEC_VERSION,
    captured_at: capturedAt.toISOString(),
    invoice_id: invoiceId,
    invoice_approval_chain_id: chainId,
    records: { invoice: invoiceRow, invoice_line: lines },
  };
}

export async function submitInTx(tx: Transaction, actor: PortalActor, invoiceId: string): Promise<void> {
  const locked = await lockOwnInvoice(tx, actor, invoiceId);
  if (locked.statusId !== (await statusId(tx, DRAFT_INVOICE_STATUS_CODE))) {
    throw new InvoiceStateError('Only a draft can be submitted.');
  }
  const lines = await tx
    .select({ timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));
  if (lines.length === 0) {
    throw new ValidationError({ lines: 'Add at least one invoice item before submitting.' });
  }
  // Rechecked: a timekeeper may have left the office or case since saving.
  const billable = new Set(await billableProfessionalIds(tx, actor, locked.caseId));
  if (lines.some((line) => line.timekeeperProfessionalId && !billable.has(line.timekeeperProfessionalId))) {
    throw new ValidationError({
      lines: 'An item bills a professional you can no longer act for on this case. Edit the draft first.',
    });
  }
  // An imported draft needs a confirmed import; its time lines become time
  // entries.
  const imported = await findImportForInvoice(tx, invoiceId);
  if (imported && imported.statusCode !== CONFIRMED_IMPORT_STATUS_CODE) {
    throw new InvoiceStateError('Confirm the imported values before submitting this invoice.');
  }
  if (imported) {
    await createTimeEntriesFromImportedLines(tx, invoiceId, imported.invoiceImportId, locked.caseId);
  }

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
    .set({ submissionSnapshot: await buildSubmissionSnapshot(tx, invoiceId, invoiceApprovalChainId, submittedAt) })
    .where(eq(invoiceApprovalChain.invoiceApprovalChainId, invoiceApprovalChainId));
  await recordInvoiceEvent(tx, {
    invoiceId,
    eventTypeCode: 'submitted',
    statusId: submittedStatusId,
    actorUserAccountId: actor.userAccountId,
    chainId: invoiceApprovalChainId,
  });
}

export async function updateDraftInvoice(db: Database, actor: PortalActor, invoiceId: string, rawInput: unknown) {
  const content = parseDraftContent(rawInput);
  return db.transaction(async (tx) => {
    const locked = await lockOwnInvoice(tx, actor, invoiceId);
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

export async function submitInvoice(db: Database, actor: PortalActor, invoiceId: string) {
  await db.transaction((tx) => submitInTx(tx, actor, invoiceId));
  return { invoiceId };
}

// Only before any decision. The recalled chain is superseded, keeping its
// snapshot.
export async function recallInvoice(db: Database, actor: PortalActor, invoiceId: string) {
  return db.transaction(async (tx) => {
    const locked = await lockOwnInvoice(tx, actor, invoiceId);
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
    const locked = await lockOwnInvoice(tx, actor, invoiceId);
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
