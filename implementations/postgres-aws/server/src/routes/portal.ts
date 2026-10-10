// The external portal: time, invoices, exports and imports, for any
// authenticated session. Time entry routes 404 without a professional
// profile; invoice routes also serve delegates, who have none.
import express, { Router, type Request } from 'express';
import { documentStore } from '../imports/documentStore';
import { MAX_UPLOAD_BYTES } from '../imports/detectFormat';
import {
  confirmInvoiceImport,
  discardInvoiceImport,
  getInvoiceImport,
  readImportFile,
  uploadInvoiceFile,
} from '../imports/invoiceImports';
import { templateCsv, templateXlsx } from '../imports/template';
import { previewFile } from '../imports/preview';
import { findImportForInvoice } from '../imports/importedTimeEntries';
import { deleteUnsubmittedInvoice, isInvoiceDeletableBy } from '../billing/deleteInvoice';
import { INVOICE_EXPORT_MEDIA_TYPES } from '../billing/exportInvoice';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { timeEntry, invoice, professional } from '../db/schema';
import { getSessionUser, requireAuth } from '../auth/session';
import { UnauthenticatedError } from '../errors';
import { billableProfessionalIds, resolvePortalActor, type PortalActor } from '../portal/portalActor';
import { createTimeEntry } from '../portal/createTimeEntry';
import { createInvoice } from '../portal/createInvoice';
import { listPortalInvoices } from '../portal/listPortalInvoices';
import { canPortalReaderReadInvoice, isExportableStatus } from '../billing/invoiceAccess';
import { loadInvoiceDetail, type InvoiceDetail } from '../billing/invoiceDetail';
import { recallInvoice, submitInvoice, updateDraftInvoice, withdrawInvoice } from '../billing/invoiceLifecycle';
import { InvoiceNotFoundError } from '../billing/reviewInvoiceLine';
import { asyncHandler } from './asyncHandler';
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

async function sessionProfessional(req: Request): Promise<{ professionalId: string } | undefined> {
  const { professionalId } = await sessionActor(req);
  return professionalId ? { professionalId } : undefined;
}

router.post(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const actor = await sessionProfessional(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const result = await createTimeEntry(db, actor, req.body);
    res.status(201).json(result);
  }),
);

router.get(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const actor = await sessionProfessional(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    const conditions = [eq(timeEntry.professionalId, actor.professionalId)];
    if (caseId) {
      conditions.push(eq(timeEntry.caseId, caseId));
    }
    const rows = await db
      .select()
      .from(timeEntry)
      .where(and(...conditions));
    res.json({ timeEntries: rows });
  }),
);

router.get(
  '/cases/:caseId/billable-professionals',
  asyncHandler(async (req, res) => {
    const actor = await sessionActor(req);
    const caseId = req.params.caseId as string;
    const ids = z.uuid().safeParse(caseId).success ? await billableProfessionalIds(db, actor, caseId) : [];
    const rows =
      ids.length === 0
        ? []
        : await db
            .select({ professionalId: professional.professionalId, displayName: professional.displayName })
            .from(professional)
            .where(inArray(professional.professionalId, ids));
    res.json({
      professionals: rows.map((row) => ({ ...row, isSelf: row.professionalId === actor.professionalId })),
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

const transitions = { submit: submitInvoice, recall: recallInvoice, withdraw: withdrawInvoice };
for (const [action, transition] of Object.entries(transitions)) {
  router.post(
    `/invoices/:id/${action}`,
    asyncHandler(async (req, res) => {
      res.json(await transition(db, await sessionActor(req), req.params.id as string));
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

// Reviewer identities stay internal; external users see outcomes and reasons.
function withoutReviewer(detail: InvoiceDetail) {
  return {
    invoice: detail.invoice,
    submissionAttempt: detail.submissionAttempt,
    lines: detail.lines.map(({ decidedByDisplayName: _reviewer, ...line }) => line),
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

router.get(
  '/invoice-imports/:id',
  asyncHandler(async (req, res) => {
    res.json(await getInvoiceImport(db, await sessionActor(req), req.params.id as string));
  }),
);

router.get(
  '/invoice-imports/:id/preview',
  asyncHandler(async (req, res) => {
    const file = await readImportFile(db, documentStore, await sessionActor(req), req.params.id as string);
    res.set('Cache-Control', 'no-store').json(await previewFile(file.mediaType, file.bytes));
  }),
);

// Always a download, so uploaded content never renders in the app's origin.
router.get(
  '/invoice-imports/:id/file',
  asyncHandler(async (req, res) => {
    const file = await readImportFile(db, documentStore, await sessionActor(req), req.params.id as string);
    res
      .type(file.mediaType)
      .attachment(file.fileName)
      .set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      .send(file.bytes);
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
