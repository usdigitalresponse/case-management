import { Router, type Request } from 'express';
import { documentStore } from '../../imports/documentStore';
import { readFileForInvoice } from '../../imports/invoiceFile';
import { findImportForInvoice } from '../../imports/importedTimeEntries';
import { deleteUnsubmittedInvoice, isInvoiceDeletableBy } from '../../billing/deleteInvoice';
import { findOverrun, loadOverrunExplanations } from '../../billing/overrunExplanation';
import { findBillingOverlaps } from '../../billing/billingOverlaps';
import { isStaffAccount } from '../../portal/portalActor';
import { z } from 'zod';
import { db } from '../../db/client';
import { createInvoice } from '../../portal/createInvoice';
import { listPortalInvoiceBatch, PORTAL_INVOICE_SHOWS } from '../../portal/listPortalInvoices';
import { batchRequest } from '../../lists/batches';
import { ValidationError } from '../../errors';
import { canPortalReaderReadInvoice, isExportableStatus } from '../../billing/invoiceAccess';
import { decisionCommentsOf, loadInvoiceDetail, type InvoiceDetail } from '../../billing/invoiceDetail';
import { recallInvoice, withdrawInvoice } from '../../billing/invoiceLifecycle/withdraw';
import { setDraftCase, setDraftCaseNumber, setDraftCounty, setDraftDetails, setDraftSender, updateDraftInvoice } from '../../billing/invoiceLifecycle/drafts';
import { submitInvoice } from '../../billing/invoiceLifecycle/submit';
import { listCounties } from '../../cases/counties';
import { InvoiceNotFoundError } from '../../billing/reviewInvoiceLine';
import { answerQuestionAsSubmitter, mayAnswerAsSubmitter } from '../../billing/reviewQuestions';
import { asyncHandler } from '../asyncHandler';
import { sendFileDownload, sendFilePreview } from '../sendUploadedFile';
import { parseExportFormat, parseExportOmit, sendInvoiceExport } from '../sendInvoiceExport';
import { sessionActor } from './sessionActor';
import { tagTourRecord } from '../../demoTour/tourRuns';

const router = Router();

router.post(
  '/invoices',
  asyncHandler(async (req, res) => {
    const result = await createInvoice(db, await sessionActor(req), req.body);
    await tagTourRecord(req, 'invoice', result.invoiceId);
    res.status(201).json(result);
  }),
);

router.put(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateDraftInvoice(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/invoices/:id/case-number',
  asyncHandler(async (req, res) => {
    res.json(await setDraftCaseNumber(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/invoices/:id/case',
  asyncHandler(async (req, res) => {
    res.json(await setDraftCase(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/invoices/:id/county',
  asyncHandler(async (req, res) => {
    res.json(await setDraftCounty(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/invoices/:id/sender',
  asyncHandler(async (req, res) => {
    res.json(await setDraftSender(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/invoices/:id/details',
  asyncHandler(async (req, res) => {
    res.json(await setDraftDetails(db, await sessionActor(req), req.params.id as string, req.body));
  }),
);

// Settings such as post-conviction first, then counties; for every county picker.
router.get(
  '/counties',
  asyncHandler(async (_req, res) => {
    res.json({ counties: await listCounties(db) });
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
    if (caseId !== undefined && !z.uuid().safeParse(caseId).success) throw new ValidationError({ caseId: 'That is not a case.' });
    const show = PORTAL_INVOICE_SHOWS.find((value) => value === req.query.show);
    res.json(await listPortalInvoiceBatch(db, reader, { caseId, show }, batchRequest(req.query)));
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
    questions: detail.questions,
    decisionComments: decisionCommentsOf(detail.signOffs),
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
    // A draft: whether sending would take its provider over their limit.
    const overrun = detail.invoice.statusCode === 'draft' ? await findOverrun(db, detail.invoice.invoiceId, false) : null;
    // A draft: what it may bill twice. Submitters see only invoices they may read.
    const billingOverlaps =
      detail.invoice.statusCode === 'draft'
        ? await findBillingOverlaps(db, detail.invoice.invoiceId, (await isStaffAccount(db, reader.userAccountId)) ? undefined : reader)
        : [];
    res.json({
      ...withoutReviewer(detail),
      import: imported ?? null,
      deletable,
      canAnswer: mayAnswerAsSubmitter(reader, detail.invoice),
      overrun,
      billingOverlaps,
      overrunExplanations: await loadOverrunExplanations(db, detail.invoice.invoiceId),
    });
  }),
);

router.post(
  '/invoices/:id/questions/:questionId/answer',
  asyncHandler(async (req, res) => {
    await loadReadableOrThrow(req);
    res.json(
      await answerQuestionAsSubmitter(db, await sessionActor(req), req.params.id as string, req.params.questionId as string, req.body),
    );
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
    await sendInvoiceExport(res, detail, format, false, parseExportOmit(req));
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

export default router;
