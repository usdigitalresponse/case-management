// Supporting invoice import (../../imports/invoiceImports/) and case-split reads.
import express, { Router } from 'express';
import { documentStore } from '../../imports/documentStore';
import { MAX_UPLOAD_BYTES } from '../../imports/detectFormat';
import { confirmInvoiceImport, discardInvoiceImport } from '../../imports/invoiceImports/resolve';
import { getInvoiceImport, listInvoiceImports, readImportFile } from '../../imports/invoiceImports/view';
import { uploadInvoiceFile } from '../../imports/invoiceImports/upload';
import { templateCsv, templateXlsx } from '../../imports/template';
import { createDraftFromUpload, discardCaseSplitRead, discardUploadRead, getCaseSplitRead, getUploadRead, startCaseSplitRead, startUploadRead, uploadInvoiceFileByCase } from '../../imports/splitByCase';
import { uploadCases } from '../../imports/caseSuggestions';
import { INVOICE_EXPORT_MEDIA_TYPES } from '../../billing/exportInvoice';
import { db } from '../../db/client';
import { asyncHandler } from '../asyncHandler';
import { sendFileDownload, sendFilePreview } from '../sendUploadedFile';
import { sessionActor } from './sessionActor';

const router = Router();

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
