// Staff invoice review: the queue, one invoice's lines and decisions, line
// review, finishing, sign-off, routing and export.
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { invoiceApprovalStepTypes, invoiceReviewAssignment, invoice, invoiceStatuses } from '../db/schema';
import { listDecisionReasons } from '../billing/decisionReasons';
import { billingRecordCsv, billingRecordXlsx, loadBillingRecord, OMITTABLE_BILLING_RECORD_COLUMNS } from '../billing/billingRecord';
import { listInvoiceIntake, matchInvoiceToCase, returnToSubmitter } from '../billing/invoiceIntake';
import { INVOICE_EXPORT_MEDIA_TYPES } from '../billing/exportInvoice';
import { loadInvoiceDetail, loadSenderEmail } from '../billing/invoiceDetail';
import { isExportableStatus } from '../billing/invoiceAccess';
import { getSessionUser, requireFullUser } from '../auth/session';
import { InvoiceNotFoundError, repriceLines, reviewInvoiceLine, undoLineDecision } from '../billing/reviewInvoiceLine';
import { finishReview, markCompleted, reopenReview, signOffInvoice } from '../billing/reviewRounds';
import {
  confirmEnteredImport,
  enterDraftInReview,
  measureEnteredTrips,
  saveEnteredLines,
  setEnteredCaseNumber,
  setEnteredCounty,
  setEnteredDetails,
  setEnteredReceipt,
  setEnteredSender,
} from '../billing/enterInReview';
import { changeInvoiceCounty } from '../billing/invoiceCounty';
import { answerQuestionAsStaff, askQuestion } from '../billing/reviewQuestions';
import { reassignReviewer, setSignOffApprovers, LINE_REVIEW_STEP_TYPE_CODE } from '../billing/reviewAssignment';
import { listReviewPeople } from '../billing/reviewAccess';
import { listReviewQueue, sentCaseNumberMatches } from '../billing/reviewQueue';
import { listRates, rateOn } from '../billing/professionalRates';
import { correctCaseNumber } from '../billing/correctCaseNumber';
import { loadPreauthorizationSummaries } from '../billing/preauthorizations';
import { IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { readFileForInvoice } from '../imports/invoiceFile';
import { MAX_UPLOAD_BYTES } from '../imports/detectFormat';
import { discardTimeLog, linkTimeLogEntries, loadTimeLogView, setTimeLogColumns, setTimeLogWorker, uploadTimeLog } from '../billing/reviewTimeLog';
import { documentStore } from '../imports/documentStore';
import { sendFileDownload, sendFilePreview } from './sendUploadedFile';
import { asyncHandler } from './asyncHandler';
import { ValidationError } from '../errors';
import { parseExportFormat, parseExportOmit, sendInvoiceExport } from './sendInvoiceExport';

const router = Router();
router.use(requireFullUser);

// requireFullUser guarantees a session user.
const actorId = (req: Request) => getSessionUser(req)!.userAccountId;

// view: open (default), finished or all; professionalId: one person's;
// q: a name or case number, close matches included; day: with an item that date.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const view = req.query.view === 'finished' || req.query.view === 'all' ? req.query.view : 'open';
    const professionalId = typeof req.query.professionalId === 'string' && z.uuid().safeParse(req.query.professionalId).success
      ? req.query.professionalId
      : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
    const day = typeof req.query.day === 'string' && z.iso.date().safeParse(req.query.day).success ? req.query.day : undefined;
    res.json(await listReviewQueue(db, view, { professionalId, q, day }));
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

router.post(
  '/intake/:id/return',
  asyncHandler(async (req, res) => {
    res.json(await returnToSubmitter(db, actorId(req), req.params.id as string, req.body));
  }),
);

const billingRecordQuery = z
  .object({
    county: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z.literal('signed-off').optional(),
    // One comma-separated value, as for one invoice's export.
    omit: z
      .string()
      .optional()
      .transform((raw) => new Set(raw ? raw.split(',') : []))
      .refine((omit) => [...omit].every((column) => (OMITTABLE_BILLING_RECORD_COLUMNS as readonly string[]).includes(column)), {
        message: 'That column cannot be left out of the billing record.',
      }),
  })
  .refine(({ from, to }) => !from || !to || from <= to, { path: ['to'], message: 'The end date must be on or after the start date.' });

// One row per submitted invoice; the query narrows the rows and leaves columns out.
router.get(
  '/billing-record',
  asyncHandler(async (req, res) => {
    const parsed = billingRecordQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? 'query'), issue.message])));
    }
    const { county, from, to, status, omit } = parsed.data;
    const rows = await loadBillingRecord(db, { countyId: county, periodFrom: from, periodTo: to, signedOffOnly: status === 'signed-off' });
    const name = [
      status === 'signed-off' ? 'signed-off' : 'billing-record',
      from && `from-${from}`,
      to && `to-${to}`,
      new Date().toISOString().slice(0, 10),
      omit.size > 0 && 'redacted',
    ]
      .filter(Boolean)
      .join('-');
    res.set('Cache-Control', 'no-store');
    if (req.query.format === 'xlsx') {
      res.type(INVOICE_EXPORT_MEDIA_TYPES.xlsx).attachment(`${name}.xlsx`).send(await billingRecordXlsx(rows, omit));
      return;
    }
    res.type('text/csv').attachment(`${name}.csv`).send(billingRecordCsv(rows, omit));
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
    const professionalId = detail.invoice.professionalId;
    const today = new Date().toISOString().slice(0, 10);
    const approvedRate = professionalId ? (rateOn(await listRates(db, [professionalId]), professionalId, today) ?? null) : null;
    const caseNumberMatches = (await sentCaseNumberMatches(db)).get(detail.invoice.invoiceId) ?? { same: 0, close: 0 };
    const senderEmail = await loadSenderEmail(db, detail.invoice);
    // As canDiscardEntry decides, from what the detail already holds.
    const discardable =
      detail.entryOpen && detail.assignments?.reviewer?.userAccountId === actorId(req) && detail.questions.length === 0;
    const timeLog = await loadTimeLogView(db, detail.invoice.invoiceId);
    res.json({ ...detail, preauthorization, approvedRate, caseNumberMatches, discardable, senderEmail, timeLog });
  }),
);

// Malformed percent-encoding keeps the name as sent.
function decodedFileName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// The raw body is the file; X-File-Name tells CSV from XLSX.
router.put(
  '/:id/time-log',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  asyncHandler(async (req, res) => {
    const fileName = req.get('X-File-Name');
    res.json(
      await uploadTimeLog(db, actorId(req), req.params.id as string, {
        fileName: fileName ? decodedFileName(fileName) : undefined,
        bytes: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        columns: typeof req.query.columns === 'string' ? req.query.columns : undefined,
      }),
    );
  }),
);

router.delete(
  '/:id/time-log',
  asyncHandler(async (req, res) => {
    res.json(await discardTimeLog(db, actorId(req), req.params.id as string));
  }),
);

router.put(
  '/:id/time-log/columns',
  asyncHandler(async (req, res) => {
    res.json(await setTimeLogColumns(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/time-log/worker',
  asyncHandler(async (req, res) => {
    res.json(await setTimeLogWorker(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/time-log/lines/:lineId',
  asyncHandler(async (req, res) => {
    res.json(await linkTimeLogEntries(db, actorId(req), req.params.id as string, req.params.lineId as string, req.body));
  }),
);

// An upload entered in review (../billing/enterInReview.ts).
router.post(
  '/:id/enter-in-review',
  asyncHandler(async (req, res) => {
    res.json(await enterDraftInReview(db, actorId(req), req.params.id as string));
  }),
);

router.put(
  '/:id/entered-lines',
  asyncHandler(async (req, res) => {
    res.json(await saveEnteredLines(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/entered-receipt',
  asyncHandler(async (req, res) => {
    res.json(await setEnteredReceipt(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/entered-case-number',
  asyncHandler(async (req, res) => {
    res.json(await setEnteredCaseNumber(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/entered-county',
  asyncHandler(async (req, res) => {
    res.json(await setEnteredCounty(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/entered-sender',
  asyncHandler(async (req, res) => {
    res.json(await setEnteredSender(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/entered-details',
  asyncHandler(async (req, res) => {
    res.json(await setEnteredDetails(db, actorId(req), req.params.id as string, req.body));
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
    await sendInvoiceExport(res, detail, format, true, parseExportOmit(req));
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
    res.json(await undoLineDecision(db, actorId(req), req.params.id as string, req.params.lineId as string, req.body));
  }),
);

router.post(
  '/:id/reprice',
  asyncHandler(async (req, res) => {
    res.json(await repriceLines(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.post(
  '/:id/finish',
  asyncHandler(async (req, res) => {
    // An invoice still being entered: its file's values are confirmed, and
    // its trips measured, before the round is finished.
    await confirmEnteredImport(db, documentStore, actorId(req), req.params.id as string);
    await measureEnteredTrips(db, actorId(req), req.params.id as string);
    res.json(await finishReview(db, actorId(req), req.params.id as string, req.body));
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

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    res.json(await markCompleted(db, actorId(req), req.params.id as string));
  }),
);

router.post(
  '/:id/questions',
  asyncHandler(async (req, res) => {
    res.status(201).json(await askQuestion(db, actorId(req), req.params.id as string, req.body));
  }),
);

// An answer the submitter gave another way, recorded by staff.
router.post(
  '/:id/questions/:questionId/answer',
  asyncHandler(async (req, res) => {
    res.json(await answerQuestionAsStaff(db, actorId(req), req.params.id as string, req.params.questionId as string, req.body));
  }),
);

router.put(
  '/:id/reviewer',
  asyncHandler(async (req, res) => {
    res.json(await reassignReviewer(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/case-number',
  asyncHandler(async (req, res) => {
    res.json(await correctCaseNumber(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/county',
  asyncHandler(async (req, res) => {
    res.json(await changeInvoiceCounty(db, actorId(req), req.params.id as string, req.body));
  }),
);

router.put(
  '/:id/sign-off-approvers',
  asyncHandler(async (req, res) => {
    res.json(await setSignOffApprovers(db, actorId(req), req.params.id as string, req.body));
  }),
);

export default router;
