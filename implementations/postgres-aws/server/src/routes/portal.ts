// The external portal: time, invoices, exports and imports, for any
// authenticated session. Time and invoice routes also serve delegates, who
// may have no professional profile of their own.
import express, { Router, type Request } from 'express';
import { documentStore } from '../imports/documentStore';
import { MAX_UPLOAD_BYTES } from '../imports/detectFormat';
import {
  confirmInvoiceImport,
  discardInvoiceImport,
  getInvoiceImport,
  listInvoiceImports,
  readImportFile,
  uploadInvoiceFile,
} from '../imports/invoiceImports';
import { templateCsv, templateXlsx } from '../imports/template';
import {
  createDraftFromUpload,
  discardCaseSplitRead,
  discardUploadRead,
  getCaseSplitRead,
  getUploadRead,
  startCaseSplitRead,
  startUploadRead,
  uploadInvoiceFileByCase,
} from '../imports/splitByCase';
import { uploadCases } from '../imports/caseSuggestions';
import { readFileForInvoice } from '../imports/invoiceFile';
import { findImportForInvoice } from '../imports/importedTimeEntries';
import { deleteUnsubmittedInvoice, isInvoiceDeletableBy } from '../billing/deleteInvoice';
import { INVOICE_EXPORT_MEDIA_TYPES } from '../billing/exportInvoice';
import { z } from 'zod';
import { and, asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { timeEntry, invoice, professional, professionalKinds } from '../db/schema';
import { getSessionUser, requireAuth } from '../auth/session';
import { UnauthenticatedError } from '../errors';
import { billableProfessionalIds, resolvePortalActor, timeReadableProfessionalIds, type PortalActor } from '../portal/portalActor';
import { createTimeEntry } from '../portal/createTimeEntry';
import {
  billingOfTimeEntry,
  deleteTimeEntry,
  timeEntryLockedReason,
  updateTimeEntry,
} from '../portal/changeTimeEntry';
import { listRates } from '../billing/professionalRates';
import { getBillingRules, listBillingCodes } from '../billing/billingRules';
import { listMileageRates } from '../billing/mileageRates';
import { createInvoice } from '../portal/createInvoice';
import { listPortalInvoices } from '../portal/listPortalInvoices';
import { canPortalReaderReadInvoice, isExportableStatus } from '../billing/invoiceAccess';
import { loadInvoiceDetail, type InvoiceDetail } from '../billing/invoiceDetail';
import { recallInvoice, submitInvoice, updateDraftInvoice, withdrawInvoice } from '../billing/invoiceLifecycle';
import { listReceiptChannels } from '../billing/invoiceReceipt';
import { InvoiceNotFoundError } from '../billing/reviewInvoiceLine';
import { asyncHandler } from './asyncHandler';
import { sendFileDownload, sendFilePreview } from './sendUploadedFile';
import { parseExportFormat, sendInvoiceExport } from './sendInvoiceExport';

const router = Router();
router.use(requireAuth);

async function sessionActor(req: Request): Promise<PortalActor> {
  const user = getSessionUser(req);
  if (!user) {
    throw new UnauthenticatedError();
  }
  return resolvePortalActor(db, user.userAccountId);
}

router.post(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const result = await createTimeEntry(db, await sessionActor(req), req.body);
    res.status(201).json(result);
  }),
);

router.get(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    if (caseId !== undefined && !z.uuid().safeParse(caseId).success) {
      res.json({ timeEntries: [] });
      return;
    }
    const actor = await sessionActor(req);
    // Others' time only case by case.
    const professionalIds = caseId
      ? await timeReadableProfessionalIds(db, actor, caseId)
      : actor.professionalId
        ? [actor.professionalId]
        : [];
    if (professionalIds.length === 0) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const conditions = [inArray(timeEntry.professionalId, professionalIds)];
    if (caseId) {
      conditions.push(eq(timeEntry.caseId, caseId));
    }
    const rows = await db
      .select({ ...getTableColumns(timeEntry), billing: billingOfTimeEntry })
      .from(timeEntry)
      .where(and(...conditions))
      .orderBy(asc(timeEntry.activityOn));
    res.json({
      timeEntries: rows.map((row) => ({ ...row, lockedReason: timeEntryLockedReason(row.billing) })),
    });
  }),
);

router.put(
  '/time-entries/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateTimeEntry(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.delete(
  '/time-entries/:id',
  asyncHandler(async (req, res) => {
    res.json(await deleteTimeEntry(db, await sessionActor(req), req.params.id as string));
  }),
);

// The rules in force, active codes and mileage rates, shown where invoices are entered.
router.get(
  '/billing-rules',
  asyncHandler(async (_req, res) => {
    res.json({
      rules: (await getBillingRules(db)).filter((rule) => rule.enforcement !== 'off'),
      codes: (await listBillingCodes(db)).filter((code) => code.active).map(({ code, displayName }) => ({ code, displayName })),
      mileageRates: await listMileageRates(db),
    });
  }),
);

// How an invoice staff enter may have been received.
router.get(
  '/receipt-channels',
  asyncHandler(async (_req, res) => {
    res.json({ channels: await listReceiptChannels(db) });
  }),
);

// Whom the user may bill for on a case, or, for staff with no case yet
// (invoice intake), any active professional.
router.get(
  ['/cases/:caseId/billable-professionals', '/billable-professionals'],
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const caseId = (req.params.caseId as string | undefined) ?? null;
    const ids = caseId === null || z.uuid().safeParse(caseId).success ? await billableProfessionalIds(db, actor, caseId) : [];
    const rows =
      ids.length === 0
        ? []
        : await db
            .select({
              professionalId: professional.professionalId,
              displayName: professional.displayName,
              kindDisplayName: professionalKinds.displayName,
            })
            .from(professional)
            .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
            .where(inArray(professional.professionalId, ids));
    // Everyone who may bill for a professional sees their rates
    // (model/rules.yaml apply_professional_rates).
    const rates = await listRates(db, ids);
    res.json({
      professionals: rows.map((row) => ({
        ...row,
        isSelf: row.professionalId === actor.professionalId,
        rates: rates
          .filter((rate) => rate.professionalId === row.professionalId)
          .map(({ hourlyRate, effectiveFrom }) => ({ hourlyRate, effectiveFrom })),
      })),
    });
  }),
);

router.post(
  '/invoices',
  asyncHandler(async (req, res) => {
    const result = await createInvoice(db, await sessionActor(req), req.body);
    res.status(201).json(result);
  }),
);

router.put(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateDraftInvoice(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.delete(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    res.json(await deleteUnsubmittedInvoice(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

router.post(
  '/invoices/:id/withdraw',
  asyncHandler(async (req, res) => {
    res.json(await withdrawInvoice(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

const transitions = { submit: submitInvoice, recall: recallInvoice };
for (const [action, transition] of Object.entries(transitions)) {
  router.post(
    `/invoices/:id/${action}`,
    asyncHandler(async (req, res) => {
      // Submit takes how and when a staff-entered invoice was received.
      res.json(await transition(db, await sessionActor(req), req.params.id as string, req.body));
    }),
  );
}

router.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const reader = await sessionActor(req);
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    const rows = await listPortalInvoices(db, reader, caseId);
    res.json({ invoices: rows });
  }),
);

// Unreadable and nonexistent invoices both 404, so IDs can't be probed.
async function loadReadableOrThrow(req: Request) {
  const reader = await sessionActor(req);
  const invoiceId = req.params.id as string;
  if (!z.uuid().safeParse(invoiceId).success || !(await canPortalReaderReadInvoice(db, reader, invoiceId))) {
    throw new InvoiceNotFoundError();
  }
  const detail = await loadInvoiceDetail(db, invoiceId);
  if (!detail) {
    throw new InvoiceNotFoundError();
  }
  return detail;
}

// Reviewer identities stay internal; external users see outcomes, reasons
// and notes of finished rounds (the detail was loaded for a submitter, so
// it has no working decisions or internal comments).
function withoutReviewer(detail: InvoiceDetail) {
  const anonymous = <T extends { decidedByDisplayName: string | null }>(decision: T) => ({ ...decision, decidedByDisplayName: null });
  return {
    invoice: detail.invoice,
    caseNumber: detail.caseNumber,
    otherCaseNumbers: detail.otherCaseNumbers,
    submissionAttempt: detail.submissionAttempt,
    ruleFindings: detail.ruleFindings,
    approvedTotal: detail.approvedTotal,
    fileSource: detail.fileSource,
    submitterChanges: detail.submitterChanges,
    lines: detail.lines.map(({ decidedByDisplayName: _reviewer, decision, history, ...line }) => ({
      ...line,
      decision: decision ? anonymous(decision) : null,
      history: history.map(anonymous),
    })),
  };
}

router.get(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const detail = await loadReadableOrThrow(req);
    const imported = await findImportForInvoice(db, detail.invoice.invoiceId);
    const reader = await sessionActor(req);
    const deletable = await isInvoiceDeletableBy(db, reader.userAccountId, detail.invoice.invoiceId);
    res.json({ ...withoutReviewer(detail), import: imported ?? null, deletable });
  }),
);

router.get(
  '/invoices/:id/export',
  asyncHandler(async (req, res) => {
    const format = parseExportFormat(req);
    const detail = await loadReadableOrThrow(req);
    if (!isExportableStatus(detail.invoice.statusCode)) {
      throw new InvoiceNotFoundError();
    }
    await sendInvoiceExport(res, detail, format, false);
  }),
);

// The file an invoice was read from, for anyone who may read the invoice.
router.get(
  '/invoices/:id/file/preview',
  asyncHandler(async (req, res) => {
    const detail = await loadReadableOrThrow(req);
    await sendFilePreview(res, await readFileForInvoice(db, documentStore, detail.invoice.invoiceId));
  }),
);

router.get(
  '/invoices/:id/file',
  asyncHandler(async (req, res) => {
    const detail = await loadReadableOrThrow(req);
    sendFileDownload(res, await readFileForInvoice(db, documentStore, detail.invoice.invoiceId));
  }),
);

// --- Supporting invoice import (../imports/invoiceImports.ts) -------------

router.get(
  '/invoice-imports/template',
  asyncHandler(async (req, res) => {
    if (req.query.format === 'xlsx') {
      res.type(INVOICE_EXPORT_MEDIA_TYPES.xlsx).attachment('invoice-template.xlsx').send(await templateXlsx());
      return;
    }
    res.type('text/csv').attachment('invoice-template.csv').send(templateCsv());
  }),
);

// The raw body is the file; X-File-Name is for display only.
router.post(
  '/invoice-imports',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  asyncHandler(async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const fileName = req.get('X-File-Name');
    const result = await uploadInvoiceFile(db, documentStore, await sessionActor(req), {
      caseId: req.query.caseId,
      professionalId: req.query.professionalId,
      fileName: fileName ? decodeURIComponent(fileName) : undefined,
      bytes,
    });
    res.status(201).json(result);
  }),
);

// A file designated to one professional whose lines name their cases
// (../imports/splitByCase.ts): read in the background like an upload, then
// previewed with a suggested case per line, then split into one import per
// case from that reading. The raw body is the file.
router.post(
  '/invoice-imports/case-split/reads',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  asyncHandler(async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const fileName = req.get('X-File-Name');
    res.status(201).json(
      await startCaseSplitRead(db, documentStore, await sessionActor(req), {
        professionalId: req.query.professionalId,
        fileName: fileName ? decodeURIComponent(fileName) : undefined,
        bytes,
      }),
    );
  }),
);

router.get(
  '/invoice-imports/case-split/reads/:id',
  asyncHandler(async (req, res) => {
    res.json(await getCaseSplitRead(db, await sessionActor(req), req.params.id as string));
  }),
);

router.delete(
  '/invoice-imports/case-split/reads/:id',
  asyncHandler(async (req, res) => {
    res.json(await discardCaseSplitRead(documentStore, await sessionActor(req), req.params.id as string));
  }),
);

router.post(
  '/invoice-imports/case-split',
  asyncHandler(async (req, res) => {
    res.status(201).json(await uploadInvoiceFileByCase(db, await sessionActor(req), req.body));
  }),
);

// The portal upload (../imports/splitByCase.ts): each file is read before
// its case is chosen, then the submitter confirms the case, period and
// invoice number and it becomes a draft. The raw body is the file.
router.post(
  '/uploads',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  asyncHandler(async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const fileName = req.get('X-File-Name');
    res.status(201).json(
      await startUploadRead(db, documentStore, await sessionActor(req), {
        fileName: fileName ? decodeURIComponent(fileName) : undefined,
        bytes,
      }),
    );
  }),
);

// The cases an invoice may be for, as the upload offers them; also used to
// start an invoice by hand.
router.get(
  '/uploads/cases',
  asyncHandler(async (req, res) => {
    const cases = await uploadCases(db, await sessionActor(req));
    res.json({ cases: cases.map(({ keys: _keys, ...row }) => row) });
  }),
);

router.get(
  '/uploads/:id',
  asyncHandler(async (req, res) => {
    res.json(await getUploadRead(db, await sessionActor(req), req.params.id as string));
  }),
);

router.delete(
  '/uploads/:id',
  asyncHandler(async (req, res) => {
    res.json(await discardUploadRead(documentStore, await sessionActor(req), req.params.id as string));
  }),
);

router.post(
  '/uploads/:id/draft',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createDraftFromUpload(db, await sessionActor(req), { ...req.body, uploadReadId: req.params.id }));
  }),
);

router.get(
  '/invoice-imports',
  asyncHandler(async (req, res) => {
    res.json({ imports: await listInvoiceImports(db, await sessionActor(req)) });
  }),
);

router.get(
  '/invoice-imports/:id',
  asyncHandler(async (req, res) => {
    res.json(await getInvoiceImport(db, await sessionActor(req), req.params.id as string));
  }),
);

router.get(
  '/invoice-imports/:id/preview',
  asyncHandler(async (req, res) => {
    await sendFilePreview(res, await readImportFile(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

router.get(
  '/invoice-imports/:id/file',
  asyncHandler(async (req, res) => {
    sendFileDownload(res, await readImportFile(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

router.post(
  '/invoice-imports/:id/confirm',
  asyncHandler(async (req, res) => {
    res.json(await confirmInvoiceImport(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

router.post(
  '/invoice-imports/:id/discard',
  asyncHandler(async (req, res) => {
    res.json(await discardInvoiceImport(db, documentStore, await sessionActor(req), req.params.id as string));
  }),
);

export default router;
