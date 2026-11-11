// Each locks the invoice row, as review does, so a recall can't race a decision.
import { and, eq, isNull } from 'drizzle-orm';
import { type Database, type Transaction } from '../../db/client';
import { document, invoice, invoiceApprovalChain, invoiceApprovalDecision } from '../../db/schema';
import { type PortalActor } from '../../portal/portalActor';
import { importDocumentIds, releaseDocumentIfUnneeded } from '../../imports/documentRetention';
import { type DocumentStore } from '../../imports/documentStore';
import { recordInvoiceEvent } from '../invoiceEvents';
import { CONFIRMED_IMPORT_STATUS_CODE, findImportForInvoice } from '../../imports/importedTimeEntries';
import { endAllAssignments } from '../reviewAssignment';
import { removeTimeLog } from '../reviewTimeLog';
import { AWAITING_MATCH_INVOICE_STATUS_CODE, DRAFT_INVOICE_STATUS_CODE, SUBMITTED_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE } from '../invoiceStatusCodes';
import { InvoiceStateError } from './lineInput';
import { lockOwnInvoice, statusId } from './drafts';

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
    await removeTimeLog(tx, invoiceId);
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
