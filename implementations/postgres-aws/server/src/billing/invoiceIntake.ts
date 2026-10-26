// Invoice intake: invoices staff entered or imported before their case was
// known (model/rules.yaml match_invoice_to_case). Any staff member may
// match one to a case, choosing whom it bills if that wasn't known and
// adding its providers to the case if they aren't on it; or its submitter
// may send it to review without a case.
import { z } from 'zod';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
import { selectInvoiceHeaders } from './invoiceDetail';
import { recordInvoiceEvent } from './invoiceEvents';
import { priceLines } from './priceLines';
import { InvoiceNotFoundError } from './reviewInvoiceLine';
import { DRAFT_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

async function requireStaff(db: Database, userAccountId: string) {
  if (!(await isStaffAccount(db, userAccountId))) {
    throw new ForbiddenError('staff_only', 'Only staff work in invoice intake.');
  }
}

export interface IntakeItem {
  invoiceId: string | null;
  invoiceImportId: string | null;
  fileName: string | null;
  // 'reading', 'unreadable', 'to_confirm' (an import to check) or 'ready'.
  stage: 'reading' | 'unreadable' | 'to_confirm' | 'ready';
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
}

export async function listInvoiceIntake(db: Database, actorUserAccountId: string): Promise<IntakeItem[]> {
  await requireStaff(db, actorUserAccountId);
  const drafts = await selectInvoiceHeaders(db).where(and(isNull(invoice.caseId), eq(invoiceStatuses.code, DRAFT_INVOICE_STATUS_CODE)));
  const draftIds = drafts.map((row) => row.invoiceId);
  const [imports, created, reading] = await Promise.all([
    draftIds.length
      ? db
          .select({
            invoiceId: invoiceImport.invoiceId,
            invoiceImportId: invoiceImport.invoiceImportId,
            statusCode: invoiceImportStatuses.code,
            fileName: document.displayName,
          })
          .from(invoiceImport)
          .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
          .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
          .where(inArray(invoiceImport.invoiceId, draftIds))
      : Promise.resolve([]),
    draftIds.length
      ? db
          .select({ invoiceId: invoiceEvent.invoiceId, occurredAt: invoiceEvent.occurredAt })
          .from(invoiceEvent)
          .where(inArray(invoiceEvent.invoiceId, draftIds))
          .orderBy(asc(invoiceEvent.occurredAt))
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
  ]);

  const items: IntakeItem[] = drafts.map((row) => {
    const imported = imports.find((entry) => entry.invoiceId === row.invoiceId);
    return {
      invoiceId: row.invoiceId,
      invoiceImportId: imported?.invoiceImportId ?? null,
      fileName: imported?.fileName ?? null,
      stage: imported && imported.statusCode !== 'confirmed' ? 'to_confirm' : 'ready',
      professionalId: row.professionalId,
      professionalDisplayName: row.professionalDisplayName,
      enteredByUserAccountId: row.submittedByUserAccountId,
      enteredByDisplayName: row.submittedByDisplayName,
      enteredAt: created.find((event) => event.invoiceId === row.invoiceId)?.occurredAt ?? new Date(),
      receivedViaDisplayName: row.receivedViaDisplayName,
      receivedOn: row.receivedOn,
      submittedTotal: row.submittedTotal,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    };
  });
  for (const file of reading) {
    items.push({
      invoiceId: null,
      invoiceImportId: file.invoiceImportId,
      fileName: file.fileName,
      stage: file.statusCode === 'failed' ? 'unreadable' : 'reading',
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
});

// Who the invoice bills: its professional and every line's.
async function billedProfessionals(db: Database, invoiceId: string, billedProfessionalId: string) {
  const lines = await db
    .select({ professionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));
  return [...new Set([billedProfessionalId, ...lines.flatMap((line) => (line.professionalId ? [line.professionalId] : []))])];
}

export async function matchInvoiceToCase(db: Database, actorUserAccountId: string, invoiceId: string, rawInput: unknown) {
  await requireStaff(db, actorUserAccountId);
  if (!z.uuid().safeParse(invoiceId).success) {
    throw new InvoiceNotFoundError();
  }
  const parsed = matchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const { caseId, addMissing } = parsed.data;
  const [row] = await db
    .select({ caseId: invoice.caseId, professionalId: invoice.professionalId, statusCode: invoiceStatuses.code })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row) {
    throw new InvoiceNotFoundError();
  }
  if (row.caseId !== null || row.statusCode !== DRAFT_INVOICE_STATUS_CODE) {
    throw new ValidationError({ caseId: 'Only an invoice still in intake can be matched to a case.' });
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
  if (row.professionalId === null) {
    const [chosen] = await db
      .select({ active: professional.active })
      .from(professional)
      .where(eq(professional.professionalId, billedProfessionalId));
    if (!chosen?.active) {
      throw new ValidationError({ professionalId: 'Choose who this invoice is from.' });
    }
  }
  const billed = await billedProfessionals(db, invoiceId, billedProfessionalId);
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
    const [locked] = await tx.select({ caseId: invoice.caseId, statusId: invoice.statusId }).from(invoice).where(eq(invoice.invoiceId, invoiceId)).for('update');
    if (!locked || locked.caseId !== null) {
      throw new ValidationError({ caseId: 'Someone else matched this invoice first.' });
    }
    await tx.update(invoice).set({ caseId, professionalId: billedProfessionalId }).where(eq(invoice.invoiceId, invoiceId));
    await tx.update(invoiceLine).set({ caseId }).where(eq(invoiceLine.invoiceId, invoiceId));
    await tx.update(invoiceImport).set({ caseId }).where(eq(invoiceImport.invoiceId, invoiceId));
    if (row.professionalId === null) {
      // Time with no one named is now the chosen professional's, at their rate.
      await priceLines(tx, invoiceId, { billedProfessionalId, unmatchedMeansBilled: true, strict: false });
    }
    await recordInvoiceEvent(tx, {
      invoiceId,
      eventTypeCode: 'matched_to_case',
      statusId: locked.statusId,
      actorUserAccountId,
    });
    return { invoiceId, caseId, addedProfessionalIds: missing };
  });
}
