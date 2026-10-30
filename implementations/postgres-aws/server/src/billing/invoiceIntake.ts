// Invoice intake: invoices staff entered or imported before their case was
// known, and those submitters sent for matching (model/rules.yaml
// match_invoice_to_case). Any staff member may match one to a case, choosing
// whom it bills and who did the work where that wasn't known, and adding its
// providers to the case if they aren't on it; or a staff submitter may send
// theirs to review without a case.
import { z } from 'zod';
import { and, eq, inArray, isNull, min, or } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  caseAssignment,
  caseTable,
  document,
  invoice,
  invoiceEvent,
  invoiceImport,
  invoiceImportStatuses,
  invoiceLine,
  invoiceStatuses,
  professional,
  userAccount,
} from '../db/schema';
import { ForbiddenError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { isStaffAccount } from '../portal/portalActor';
import { assignExternalSubmitterToCase } from '../cases/assignExternalSubmitterToCase';
import { selectInvoiceHeaders, type InvoiceHeader } from './invoiceDetail';
import { recordInvoiceEvent, RETURNED_TO_SUBMITTER_EVENT_CODE } from './invoiceEvents';
import { getReferenceId } from '../db/referenceLookups';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { priceLines } from './priceLines';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { AWAITING_MATCH_INVOICE_STATUS_CODE, DRAFT_INVOICE_STATUS_CODE } from './invoiceStatusCodes';
import { releaseToReviewInTx } from './invoiceLifecycle';
import { unmatchedTimekeeper } from './proposedDetails';

async function requireStaff(db: Database, userAccountId: string) {
  if (!(await isStaffAccount(db, userAccountId))) {
    throw new ForbiddenError('staff_only', 'Only staff work in invoice intake.');
  }
}

export interface IntakeItem {
  invoiceId: string | null;
  invoiceImportId: string | null;
  fileName: string | null;
  // 'reading', 'unreadable', 'to_confirm' (an import to check), 'ready', or
  // 'sent' (sent for matching by its submitter).
  stage: 'reading' | 'unreadable' | 'to_confirm' | 'ready' | 'sent';
  caseId: string | null;
  // What the submitter entered for what wasn't listed.
  proposedCase: InvoiceHeader['proposedCase'];
  proposedProvider: InvoiceHeader['proposedProvider'];
  unlistedTimekeepers: Array<{ invoiceLineId: string; name: string; email: string | null; description: string | null }>;
  professionalId: string | null;
  professionalDisplayName: string | null;
  enteredByUserAccountId: string;
  enteredByDisplayName: string | null;
  enteredAt: Date;
  receivedViaDisplayName: string | null;
  receivedOn: string | null;
  submittedTotal: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  // Named by the file; staff confirm it on matching.
  suggestedCaseId: string | null;
  suggestedProfessionalId: string | null;
}

export async function listInvoiceIntake(db: Database, actorUserAccountId: string): Promise<IntakeItem[]> {
  await requireStaff(db, actorUserAccountId);
  const staffRoleIds = await getStaffAccountRoleIds(db);
  const drafts = await selectInvoiceHeaders(db).where(
    or(
      // A submitter's own drafts stay theirs until they send them.
      and(isNull(invoice.caseId), eq(invoiceStatuses.code, DRAFT_INVOICE_STATUS_CODE), inArray(userAccount.systemRoleId, staffRoleIds)),
      eq(invoiceStatuses.code, AWAITING_MATCH_INVOICE_STATUS_CODE),
    ),
  );
  const draftIds = drafts.map((row) => row.invoiceId);
  const [imports, created, reading, unlisted] = await Promise.all([
    draftIds.length
      ? db
          .select({
            invoiceId: invoiceImport.invoiceId,
            invoiceImportId: invoiceImport.invoiceImportId,
            statusCode: invoiceImportStatuses.code,
            fileName: document.displayName,
            suggestedCaseId: invoiceImport.suggestedCaseId,
            suggestedProfessionalId: invoiceImport.suggestedProfessionalId,
          })
          .from(invoiceImport)
          .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
          .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
          .where(inArray(invoiceImport.invoiceId, draftIds))
      : Promise.resolve([]),
    draftIds.length
      ? db
          .select({ invoiceId: invoiceEvent.invoiceId, occurredAt: min(invoiceEvent.occurredAt) })
          .from(invoiceEvent)
          .where(inArray(invoiceEvent.invoiceId, draftIds))
          .groupBy(invoiceEvent.invoiceId)
      : Promise.resolve([]),
    // Files with no case still being read, or that couldn't be read.
    db
      .select({
        invoiceImportId: invoiceImport.invoiceImportId,
        statusCode: invoiceImportStatuses.code,
        fileName: document.displayName,
        uploadedAt: invoiceImport.uploadedAt,
        uploadedBy: invoiceImport.uploadedByUserAccountId,
        uploadedByName: userAccount.displayName,
      })
      .from(invoiceImport)
      .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
      .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
      .innerJoin(userAccount, eq(invoiceImport.uploadedByUserAccountId, userAccount.userAccountId))
      .where(and(isNull(invoiceImport.caseId), isNull(invoiceImport.invoiceId), inArray(invoiceImportStatuses.code, ['received', 'failed']))),
    draftIds.length
      ? db
          .select({
            invoiceId: invoiceLine.invoiceId,
            invoiceLineId: invoiceLine.invoiceLineId,
            name: invoiceLine.proposedTimekeeperName,
            email: invoiceLine.proposedTimekeeperEmail,
            description: invoiceLine.description,
          })
          .from(invoiceLine)
          .where(and(inArray(invoiceLine.invoiceId, draftIds), unmatchedTimekeeper))
      : Promise.resolve([]),
  ]);

  const importFor = new Map(imports.map((entry) => [entry.invoiceId, entry]));
  const createdAt = new Map(created.map((event) => [event.invoiceId, event.occurredAt]));
  const unlistedFor = new Map<string, typeof unlisted>();
  for (const line of unlisted) {
    unlistedFor.set(line.invoiceId, [...(unlistedFor.get(line.invoiceId) ?? []), line]);
  }
  const items: IntakeItem[] = drafts.map((row) => {
    const imported = importFor.get(row.invoiceId);
    return {
      invoiceId: row.invoiceId,
      invoiceImportId: imported?.invoiceImportId ?? null,
      fileName: imported?.fileName ?? null,
      stage:
        row.statusCode === AWAITING_MATCH_INVOICE_STATUS_CODE ? 'sent' : imported && imported.statusCode !== 'confirmed' ? 'to_confirm' : 'ready',
      caseId: row.caseId,
      proposedCase: row.proposedCase,
      proposedProvider: row.proposedProvider,
      unlistedTimekeepers: (unlistedFor.get(row.invoiceId) ?? []).map((line) => ({
        invoiceLineId: line.invoiceLineId,
        name: line.name ?? '',
        email: line.email,
        description: line.description,
      })),
      professionalId: row.professionalId,
      professionalDisplayName: row.professionalDisplayName,
      enteredByUserAccountId: row.submittedByUserAccountId,
      enteredByDisplayName: row.submittedByDisplayName,
      enteredAt: createdAt.get(row.invoiceId) ?? new Date(),
      receivedViaDisplayName: row.receivedViaDisplayName,
      receivedOn: row.receivedOn,
      submittedTotal: row.submittedTotal,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      suggestedCaseId: imported?.suggestedCaseId ?? null,
      suggestedProfessionalId: imported?.suggestedProfessionalId ?? null,
    };
  });
  for (const file of reading) {
    items.push({
      invoiceId: null,
      invoiceImportId: file.invoiceImportId,
      fileName: file.fileName,
      stage: file.statusCode === 'failed' ? 'unreadable' : 'reading',
      caseId: null,
      proposedCase: null,
      proposedProvider: null,
      unlistedTimekeepers: [],
      professionalId: null,
      professionalDisplayName: null,
      enteredByUserAccountId: file.uploadedBy,
      enteredByDisplayName: file.uploadedByName,
      enteredAt: file.uploadedAt,
      receivedViaDisplayName: null,
      receivedOn: null,
      submittedTotal: null,
      periodStart: null,
      periodEnd: null,
      suggestedCaseId: null,
      suggestedProfessionalId: null,
    });
  }
  // Longest held first.
  return items.sort((a, b) => Number(a.enteredAt) - Number(b.enteredAt));
}

const matchInputSchema = z.object({
  caseId: z.uuid(),
  // Add providers who aren't on the case yet; refused without it.
  addMissing: z.boolean().default(false),
  // Whom it bills, for an invoice saved before that was known.
  professionalId: z.uuid().optional(),
  // Who did the work, for each line naming someone who wasn't listed.
  timekeepers: z.record(z.uuid(), z.uuid()).default({}),
});

// Who the invoice bills: its professional and every line's.
async function billedProfessionals(db: Database, invoiceId: string, billedProfessionalId: string) {
  const lines = await db
    .select({ professionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));
  return [...new Set([billedProfessionalId, ...lines.flatMap((line) => (line.professionalId ? [line.professionalId] : []))])];
}

const returnInputSchema = z.object({
  reason: z.string().trim().min(1, 'Say what the submitter should change.').max(2000, 'Keep the reason under 2,000 characters.'),
});

// Sends a request waiting to be matched back to its submitter's drafts
// (return_to_submitter), with the reason they're shown until they send it again.
export async function returnToSubmitter(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  await requireStaff(db, actorUserAccountId);
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const parsed = returnInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ statusCode: invoiceStatuses.code })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(eq(invoice.invoiceId, invoiceId))
      .for('update', { of: invoice });
    if (!locked) {
      throw new InvoiceNotFoundError();
    }
    if (locked.statusCode !== AWAITING_MATCH_INVOICE_STATUS_CODE) {
      throw new ValidationError({ reason: 'Only an invoice waiting to be matched can be sent back.' });
    }
    const draftStatusId = await getReferenceId(tx, invoiceStatuses, DRAFT_INVOICE_STATUS_CODE);
    await tx.update(invoice).set({ statusId: draftStatusId }).where(eq(invoice.invoiceId, invoiceId));
    await recordInvoiceEvent(tx, {
      invoiceId,
      eventTypeCode: RETURNED_TO_SUBMITTER_EVENT_CODE,
      statusId: draftStatusId,
      actorUserAccountId,
      reason: parsed.data.reason,
    });
    return { invoiceId };
  });
}

// Matches a request held in intake or sent for matching to its case,
// provider and timekeepers; one sent for matching then goes to review
// (release_to_review). Returns whether it did.
export async function matchInvoiceToCase(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  await requireStaff(db, actorUserAccountId);
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const parsed = matchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { caseId, addMissing, timekeepers } = parsed.data;
  const [row] = await db
    .select({ caseId: invoice.caseId, professionalId: invoice.professionalId, statusCode: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row) {
    throw new InvoiceNotFoundError();
  }
  const awaiting = row.statusCode === AWAITING_MATCH_INVOICE_STATUS_CODE;
  if (!(awaiting || (row.statusCode === DRAFT_INVOICE_STATUS_CODE && row.caseId === null))) {
    throw new ValidationError({ caseId: 'Only an invoice still in intake can be matched to a case.' });
  }
  if (row.caseId !== null && row.caseId !== caseId) {
    throw new ValidationError({ caseId: 'This invoice already has its case.' });
  }
  const [target] = await db.select({ closedOn: caseTable.closedOn }).from(caseTable).where(eq(caseTable.caseId, caseId));
  if (!target) {
    throw new ValidationError({ caseId: 'Choose a case.' });
  }
  if (target.closedOn) {
    throw new ValidationError({ caseId: 'That case is closed. Choose an open case.' });
  }

  const billedProfessionalId = row.professionalId ?? parsed.data.professionalId;
  if (!billedProfessionalId) {
    throw new ValidationError({ professionalId: 'Choose who this invoice is from.' });
  }
  const unlisted = await db
    .select({ invoiceLineId: invoiceLine.invoiceLineId })
    .from(invoiceLine)
    .where(and(eq(invoiceLine.invoiceId, invoiceId), unmatchedTimekeeper));
  if (Object.keys(timekeepers).some((lineId) => !unlisted.some((line) => line.invoiceLineId === lineId))) {
    throw new ValidationError({ timekeepers: 'Only items naming someone not listed can be matched here.' });
  }
  const chosen = [...new Set([...(row.professionalId === null ? [billedProfessionalId] : []), ...Object.values(timekeepers)])];
  const active = chosen.length
    ? await db.select({ professionalId: professional.professionalId }).from(professional).where(and(inArray(professional.professionalId, chosen), eq(professional.active, true)))
    : [];
  if (active.length !== chosen.length) {
    throw new ValidationError({ professionalId: 'Choose providers who are active.' });
  }
  const billed = [...new Set([...(await billedProfessionals(db, invoiceId, billedProfessionalId)), ...Object.values(timekeepers)])];
  const onCase = await db
    .select({ professionalId: caseAssignment.professionalId })
    .from(caseAssignment)
    .where(and(eq(caseAssignment.caseId, caseId), isNull(caseAssignment.endedAt), inArray(caseAssignment.professionalId, billed)));
  const missing = billed.filter((id) => !onCase.some((assignment) => assignment.professionalId === id));
  if (missing.length > 0) {
    if (!addMissing) {
      const names = await db
        .select({ displayName: professional.displayName })
        .from(professional)
        .where(inArray(professional.professionalId, missing));
      throw new ValidationError({
        addMissing: `${names.map((name) => name.displayName ?? 'A provider').join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} on this case. Add ${missing.length === 1 ? 'them' : 'them all'} to match.`,
      });
    }
    for (const professionalId of missing) {
      // eslint-disable-next-line no-await-in-loop
      await assignExternalSubmitterToCase(db, actorUserAccountId, caseId, { professionalId });
    }
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ caseId: invoice.caseId, statusId: invoice.statusId })
      .from(invoice)
      .where(eq(invoice.invoiceId, invoiceId))
      .for('update');
    if (!locked || locked.caseId !== row.caseId) {
      throw new ValidationError({ caseId: 'Someone else matched this invoice first.' });
    }
    await tx.update(invoice).set({ caseId, professionalId: billedProfessionalId }).where(eq(invoice.invoiceId, invoiceId));
    await tx.update(invoiceLine).set({ caseId }).where(eq(invoiceLine.invoiceId, invoiceId));
    await tx.update(invoiceImport).set({ caseId }).where(eq(invoiceImport.invoiceId, invoiceId));
    for (const [invoiceLineId, professionalId] of Object.entries(timekeepers)) {
      // eslint-disable-next-line no-await-in-loop
      await tx.update(invoiceLine).set({ timekeeperProfessionalId: professionalId }).where(eq(invoiceLine.invoiceLineId, invoiceLineId));
    }
    // Time with no one named is now the chosen professional's, at their rate.
    await priceLines(tx, invoiceId, { billedProfessionalId, unmatchedMeansBilled: true, strict: false });
    await recordInvoiceEvent(tx, {
      invoiceId,
      eventTypeCode: 'matched_to_case',
      statusId: locked.statusId,
      actorUserAccountId,
    });
    // The match stands even if the invoice can't go to review yet.
    let released = false;
    let releaseProblem: string | undefined;
    if (awaiting) {
      try {
        released = await tx.transaction((inner) => releaseToReviewInTx(inner, actorUserAccountId, invoiceId));
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        releaseProblem = Object.values(error.fieldErrors)[0] ?? 'It could not go to review yet.';
      }
    }
    return { invoiceId, caseId, addedProfessionalIds: missing, released, releaseProblem };
  });
}
