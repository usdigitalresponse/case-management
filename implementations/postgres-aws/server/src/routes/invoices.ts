// Staff invoice review: the queue, one invoice's lines and decisions, line
// review, finishing, sign-off, routing and export.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { invoiceApprovalStepTypes, invoiceReviewAssignment, invoice, invoiceStatuses } from '../db/schema';
import { listDecisionReasons } from '../billing/decisionReasons';
import { billingRecordCsv, billingRecordXlsx, loadBillingRecord } from '../billing/billingRecord';
import { listInvoiceIntake, matchInvoiceToCase } from '../billing/invoiceIntake';
import { INVOICE_EXPORT_MEDIA_TYPES } from '../billing/exportInvoice';
import { loadInvoiceDetail } from '../billing/invoiceDetail';
import { isExportableStatus } from '../billing/invoiceAccess';
import { getSessionUser, requireFullUser } from '../auth/session';
import { InvoiceNotFoundError, repriceLines, reviewInvoiceLine, undoLineDecision } from '../billing/reviewInvoiceLine';
import { finishReview, reopenReview, signOffInvoice } from '../billing/reviewRounds';
import { reassignReviewer, setSignOffApprovers, LINE_REVIEW_STEP_TYPE_CODE } from '../billing/reviewAssignment';
import { listReviewPeople } from '../billing/reviewAccess';
import { listReviewQueue } from '../billing/reviewQueue';
import { loadPreauthorizationSummaries } from '../billing/preauthorizations';
import { IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { readFileForInvoice } from '../imports/invoiceFile';
import { documentStore } from '../imports/documentStore';
import { sendFileDownload, sendFilePreview } from './sendUploadedFile';
import { asyncHandler } from './asyncHandler';
import { parseExportFormat, sendInvoiceExport } from './sendInvoiceExport';

const router = Router();
router.use(requireFullUser);

// requireFullUser guarantees a session user.
const actorId = (req: Request) => getSessionUser(req)!.userAccountId;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listReviewQueue(db, req.query.view === 'finished' ? 'finished' : 'open'));
  }),
);

// Invoice intake: invoices not yet matched to a case, and matching one.
router.get(
  '/intake',
  asyncHandler(async (req, res) => {
    res.json({ items: await listInvoiceIntake(db, actorId(req)) });
  }),
);

router.post(
  '/intake/:id/case',
  asyncHandler(async (req, res) => {
    res.json(await matchInvoiceToCase(db, actorId(req), req.params.id as string, req.body));
  }),
);

// Every submitted invoice, one row each, for reports outside the tool.
router.get(
  '/billing-record',
  asyncHandler(async (req, res) => {
    const rows = await loadBillingRecord(db);
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Cache-Control', 'no-store');
    if (req.query.format === 'xlsx') {
      res.type(INVOICE_EXPORT_MEDIA_TYPES.xlsx).attachment(`billing-record-${stamp}.xlsx`).send(await billingRecordXlsx(rows));
      return;
    }
    res.type('text/csv').attachment(`billing-record-${stamp}.csv`).send(billingRecordCsv(rows));
  }),
);

router.get(
  '/decision-reasons',
  asyncHandler(async (_req, res) => {
    const reasons = await listDecisionReasons(db, { activeOnly: true });
    res.json({ reasons: reasons.map(({ code, displayName, appliesTo }) => ({ code, displayName, appliesTo })) });
  }),
);

// People who can be given an invoice or sign it off, with how many
// invoices each has waiting for review.
router.get(
  '/reviewers',
  asyncHandler(async (_req, res) => {
    const people = (await listReviewPeople(db)).filter((person) => person.permissions.reviewLines || person.permissions.signOff);
    const waiting = await db
      .select({ userAccountId: invoiceReviewAssignment.assignedUserAccountId, waiting: count() })
      .from(invoiceReviewAssignment)
      .innerJoin(invoice, eq(invoiceReviewAssignment.invoiceId, invoice.invoiceId))
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .innerJoin(invoiceApprovalStepTypes, eq(invoiceReviewAssignment.stepTypeId, invoiceApprovalStepTypes.id))
      .where(
        and(
          isNull(invoiceReviewAssignment.endedAt),
          inArray(invoiceStatuses.code, IN_REVIEW_INVOICE_STATUS_CODES),
          eq(invoiceApprovalStepTypes.code, LINE_REVIEW_STEP_TYPE_CODE),
        ),
      )
      .groupBy(invoiceReviewAssignment.assignedUserAccountId);
    res.json({
      people: people.map((person) => ({
        userAccountId: person.userAccountId,
        displayName: person.displayName,
        roleName: person.roleName,
        reviewsLines: person.permissions.reviewLines,
        signsOff: person.permissions.signOff,
        waiting: waiting.find((row) => row.userAccountId === person.userAccountId)?.waiting ?? 0,
      })),
    });
  }),
);

async function loadOrThrow(invoiceId: string) {
  const detail = z.uuid().safeParse(invoiceId).success ? await loadInvoiceDetail(db, invoiceId, 'staff') : undefined;
  if (!detail) {
    throw new InvoiceNotFoundError();
  }
  return detail;
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const detail = await loadOrThrow(req.params.id as string);
    // This professional's pre-authorization on the case, for the facts strip.
    const preauthorization = detail.invoice.caseId
      ? ((await loadPreauthorizationSummaries(db, detail.invoice.caseId)).find(
          (summary) => summary.professionalId === null || summary.professionalId === detail.invoice.professionalId,
        ) ?? null)
      : null;
    res.json({ ...detail, preauthorization });
  }),
);

router.get(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const format = parseExportFormat(req);
    const detail = await loadOrThrow(req.params.id as string);
    if (!isExportableStatus(detail.invoice.statusCode)) {
      throw new InvoiceNotFoundError();
    }
    await sendInvoiceExport(res, detail, format, true);
  }),
);

// The file the request was read from, beside its lines.
router.get(
  '/:id/file/preview',
  asyncHandler(async (req, res) => {
    const detail = await loadOrThrow(req.params.id as string);
    await sendFilePreview(res, await readFileForInvoice(db, documentStore, detail.invoice.invoiceId));
  }),
);

router.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const detail = await loadOrThrow(req.params.id as string);
    sendFileDownload(res, await readFileForInvoice(db, documentStore, detail.invoice.invoiceId));
  }),
);

router.put(
  '/:id/lines/:lineId/decision',
  asyncHandler(async (req, res) => {
    res.json(await reviewInvoiceLine(db, actorId(req), req.params.id as string, req.params.lineId as string, req.body));
  }),
);

router.delete(
  '/:id/lines/:lineId/decision',
  asyncHandler(async (req, res) => {
    res.json(await undoLineDecision(db, actorId(req), req.params.id as string, req.params.lineId as string));
  }),
);

router.post(
  '/:id/reprice',
  asyncHandler(async (req, res) => {
    res.json(await repriceLines(db, actorId(req), req.params.id as string));
  }),
);

router.post(
  '/:id/finish',
  asyncHandler(async (req, res) => {
    res.json(await finishReview(db, actorId(req), req.params.id as string));
  }),
);

router.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    res.json(await reopenReview(db, actorId(req), req.params.id as string));
  }),
);

router.post(
  '/:id/sign-off',
  asyncHandler(async (req, res) => {
    res.json(await signOffInvoice(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/reviewer',
  asyncHandler(async (req, res) => {
    res.json(await reassignReviewer(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/sign-off-approvers',
  asyncHandler(async (req, res) => {
    res.json(await setSignOffApprovers(db, actorId(req), req.params.id as string, req.body));
  }),
);

export default router;
