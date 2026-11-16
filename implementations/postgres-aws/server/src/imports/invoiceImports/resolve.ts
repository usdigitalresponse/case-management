import { z } from 'zod';
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { type Database, type Transaction } from '../../db/client';
import { getReferenceId } from '../../db/referenceLookups';
import { document, invoice, invoiceImport, invoiceImportStatuses, invoiceLine, invoiceStatuses } from '../../db/schema';
import { ValidationError } from '../../errors';
import { NotAssignedToCaseError } from '../../portal/caseAssignmentAuthorization';
import { authorizeBilling, type PortalActor } from '../../portal/portalActor';
import { InvoiceStateError } from '../../billing/invoiceLifecycle/lineInput';
import { withdrawDraftInTx } from '../../billing/invoiceLifecycle/withdraw';
import { DRAFT_INVOICE_STATUS_CODE } from '../../billing/invoiceStatusCodes';
import { type DocumentStore } from '../documentStore';
import { hasUnmatchedTimekeepers } from '../../billing/proposedDetails';
import { cancelExtraction } from '../extractionJobs';
import { CONFIRMED_IMPORT_STATUS_CODE } from '../importedTimeEntries';
import { releaseDocumentIfUnneeded } from '../documentRetention';
import { priceLines } from '../../billing/priceLines';
import { enforceBillingRules } from '../../billing/billingRules';
import { requireImportedDates } from '../undatedLines';
import { InvoiceImportNotFoundError, UNRESOLVED_STATUS_CODES, importStatusId } from './importStatus';

export const IMPORT_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

// Deletes stored files no live document refers to, left by a crash or by case-split reads a restart forgot.
// `keep` holds files in use without a document yet.
export async function removeUnreferencedFiles(db: Database, store: DocumentStore, keep: Set<string> = new Set()): Promise<number> {
  const stored = (await store.list()).filter((reference) => !keep.has(reference));
  if (stored.length === 0) {
    return 0;
  }
  const live = await db
    .select({ storageReference: document.storageReference })
    .from(document)
    .where(and(inArray(document.storageReference, stored), isNull(document.contentDeletedAt)));
  const referenced = new Set(live.map((row) => row.storageReference));
  const unreferenced = stored.filter((reference) => !referenced.has(reference));
  for (const reference of unreferenced) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(reference);
  }
  return unreferenced.length;
}

// Anyone but the uploader gets a 404.
async function lockOwnImport(tx: Transaction, actor: PortalActor, importId: string) {
  if (!z.uuid().safeParse(importId).success) {
    throw new InvoiceImportNotFoundError();
  }
  const [row] = await tx
    .select({
      invoiceImportId: invoiceImport.invoiceImportId,
      uploadedBy: invoiceImport.uploadedByUserAccountId,
      statusCode: invoiceImportStatuses.code,
      invoiceId: invoiceImport.invoiceId,
      documentId: invoiceImport.documentId,
      storageReference: document.storageReference,
    })
    .from(invoiceImport)
    .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
    .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
    .where(eq(invoiceImport.invoiceImportId, importId))
    .for('update', { of: invoiceImport });
  if (!row || row.uploadedBy !== actor.userAccountId) {
    throw new InvoiceImportNotFoundError();
  }
  return row;
}

// Returns the file's storage reference when nothing needs it any more
// (../documentRetention.ts), for the caller to delete after commit. A
// confirmed import keeps its file with the request.
async function resolveImport(
  tx: Transaction,
  importId: string,
  documentId: string,
  statusCode: string,
  resolvedBy: string | null,
): Promise<string | undefined> {
  // Serializes sibling imports resolving at once.
  await tx.select({ documentId: document.documentId }).from(document).where(eq(document.documentId, documentId)).for('update');
  await tx
    .update(invoiceImport)
    .set({ statusId: await importStatusId(tx, statusCode), resolvedByUserAccountId: resolvedBy, resolvedAt: new Date() })
    .where(eq(invoiceImport.invoiceImportId, importId));
  return releaseDocumentIfUnneeded(tx, documentId);
}

async function lockDraft(tx: Transaction, invoiceId: string) {
  const [row] = await tx
    .select({ statusId: invoice.statusId, caseId: invoice.caseId, professionalId: invoice.professionalId })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId))
    .for('update');
  return row;
}

async function withdrawImportDraft(tx: Transaction, invoiceId: string | null, by: Parameters<typeof withdrawDraftInTx>[2]) {
  if (!invoiceId) {
    return;
  }
  const draft = await lockDraft(tx, invoiceId);
  if (draft && draft.statusId === (await getReferenceId(tx, invoiceStatuses, DRAFT_INVOICE_STATUS_CODE))) {
    await withdrawDraftInTx(tx, invoiceId, by);
  }
}

export async function confirmInvoiceImport(db: Database, store: DocumentStore, actor: PortalActor, importId: string) {
  const storageReference = await db.transaction(async (tx) => confirmImportInTx(tx, actor, await lockOwnImport(tx, actor, importId)));
  if (storageReference) {
    await store.delete(storageReference);
  }
  return { invoiceImportId: importId };
}

// Confirms a locked import as `actor`, returning a file nothing needs any
// more for the caller to delete after commit. An invoice entered in review
// is confirmed this way by its reviewer (../../billing/enterInReview.ts).
export async function confirmImportInTx(
  tx: Transaction,
  actor: PortalActor,
  row: { invoiceImportId: string; statusCode: string; invoiceId: string | null; documentId: string },
): Promise<string | undefined> {
  const importId = row.invoiceImportId;
  // Confirming again, as a send retried after a refusal does, changes nothing.
  if (row.statusCode === CONFIRMED_IMPORT_STATUS_CODE) {
    return undefined;
  }
  if (row.statusCode !== 'extracted' || !row.invoiceId) {
    throw new InvoiceStateError('Only an import that was read successfully and not yet resolved can be confirmed.');
  }
  const draft = await lockDraft(tx, row.invoiceId);
  if (!draft) {
    throw new NotAssignedToCaseError();
  }
  await authorizeBilling(tx, actor, draft.caseId, draft.professionalId);
  // A file designated to one professional is all their work, lines the
  // submitter added included.
  const [designation] = await tx
    .select({ professionalId: sql<string | null>`${invoiceImport.extractionResult} ->> 'designated_professional_id'` })
    .from(invoiceImport)
    .where(eq(invoiceImport.invoiceImportId, importId));
  const designated = designation?.professionalId;
  if (designated) {
    await tx
      .update(invoiceLine)
      .set({ timekeeperProfessionalId: designated })
      .where(and(eq(invoiceLine.invoiceId, row.invoiceId), isNull(invoiceLine.timekeeperProfessionalId)));
  }
  // Someone the file names but no one chose is left for staff to match,
  // as if the submitter had named them as new.
  await tx
    .update(invoiceLine)
    .set({ proposedTimekeeperName: invoiceLine.timekeeperLabel })
    .where(
      and(
        eq(invoiceLine.invoiceId, row.invoiceId),
        isNull(invoiceLine.timekeeperProfessionalId),
        isNull(invoiceLine.proposedTimekeeperName),
        isNotNull(invoiceLine.timekeeperLabel),
      ),
    );
  const lines = await tx
    .select({ timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, row.invoiceId));
  if (designated && lines.some((line) => line.timekeeperProfessionalId !== designated)) {
    throw new ValidationError({ lines: 'Every item in this file is the work of the professional it was imported for.' });
  }
  if (lines.length === 0) {
    throw new ValidationError({ lines: 'Add at least one invoice item before confirming.' });
  }
  await requireImportedDates(tx, row.invoiceId);
  // From here the configured rates price each time line, not the file. With
  // someone still to be matched, that waits until it's released to review.
  const matched = draft.professionalId !== null && !(await hasUnmatchedTimekeepers(tx, row.invoiceId));
  await priceLines(tx, row.invoiceId, {
    billedProfessionalId: draft.professionalId,
    unmatchedMeansBilled: true,
    strict: matched,
  });
  if (matched) {
    await enforceBillingRules(tx, row.invoiceId);
  }
  return resolveImport(tx, importId, row.documentId, CONFIRMED_IMPORT_STATUS_CODE, actor.userAccountId);
}

// Allowed even if the uploader can no longer act for the case.
export async function discardInvoiceImport(db: Database, store: DocumentStore, actor: PortalActor, importId: string) {
  const storageReference = await db.transaction(async (tx) => {
    const row = await lockOwnImport(tx, actor, importId);
    if (!UNRESOLVED_STATUS_CODES.includes(row.statusCode)) {
      throw new InvoiceStateError('This import is already confirmed or discarded.');
    }
    await withdrawImportDraft(tx, row.invoiceId, { actorUserAccountId: actor.userAccountId });
    return resolveImport(tx, importId, row.documentId, 'discarded', actor.userAccountId);
  });
  // A file still being read stops being read.
  cancelExtraction(importId);
  if (storageReference) {
    await store.delete(storageReference);
  }
  return { invoiceImportId: importId };
}

// When a file that couldn't be read is discarded; null for any other import.
export const expiryOf = (row: { statusCode: string; uploadedAt: Date }) =>
  row.statusCode === 'failed' ? new Date(row.uploadedAt.getTime() + IMPORT_EXPIRY_MS) : null;

// Discards files that couldn't be read three days after upload, as a system action, and retries recent file
// deletions. A file that was read is a draft, which never expires.
export async function expireInvoiceImports(db: Database, store: DocumentStore, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IMPORT_EXPIRY_MS);
  const failedStatusId = await importStatusId(db, 'failed');
  const stale = await db
    .select({ invoiceImportId: invoiceImport.invoiceImportId })
    .from(invoiceImport)
    .where(and(eq(invoiceImport.statusId, failedStatusId), lt(invoiceImport.uploadedAt, cutoff)));

  let expired = 0;
  for (const { invoiceImportId } of stale) {
    // eslint-disable-next-line no-await-in-loop
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          statusId: invoiceImport.statusId,
          invoiceId: invoiceImport.invoiceId,
          documentId: invoiceImport.documentId,
          storageReference: document.storageReference,
        })
        .from(invoiceImport)
        .innerJoin(document, eq(invoiceImport.documentId, document.documentId))
        .where(eq(invoiceImport.invoiceImportId, invoiceImportId))
        .for('update', { of: invoiceImport });
      // Resolved by its uploader since the scan.
      if (!row || row.statusId !== failedStatusId) {
        return undefined;
      }
      return { storageReference: await resolveImport(tx, invoiceImportId, row.documentId, 'discarded', null) };
    });
    if (result) {
      expired += 1;
      cancelExtraction(invoiceImportId);
      if (result.storageReference) {
        // eslint-disable-next-line no-await-in-loop
        await store.delete(result.storageReference);
      }
    }
  }

  const deleted = await db
    .select({ storageReference: document.storageReference })
    .from(document)
    .where(gte(document.contentDeletedAt, cutoff));
  for (const { storageReference } of deleted) {
    // eslint-disable-next-line no-await-in-loop
    await store.delete(storageReference);
  }
  return expired;
}
