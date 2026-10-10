// Staff invoice review: the cross-case queue, one invoice's lines with
// their decisions, line review and export.
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, notInArray, type SQL } from 'drizzle-orm';
import { UNSUBMITTED_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { db } from '../db/client';
import { invoice, invoiceStatuses } from '../db/schema';
import { loadInvoiceDetail, selectInvoiceHeaders } from '../billing/invoiceDetail';
import { isExportableStatus } from '../billing/invoiceAccess';
import { getSessionUser, requireFullUser } from '../auth/session';
import { InvoiceNotFoundError, reviewInvoiceLine } from '../billing/reviewInvoiceLine';
import { asyncHandler } from './asyncHandler';
import { parseExportFormat, sendInvoiceExport } from './sendInvoiceExport';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters: SQL[] = [notInArray(invoiceStatuses.code, UNSUBMITTED_INVOICE_STATUS_CODES)];
    if (typeof req.query.status === 'string') {
      filters.push(eq(invoiceStatuses.code, req.query.status));
    }

    const rows = await selectInvoiceHeaders(db)
      .where(and(...filters))
      .orderBy(asc(invoice.submittedAt));
    res.json({ invoices: rows });
  }),
);

async function loadOrThrow(invoiceId: string) {
  const detail = z.uuid().safeParse(invoiceId).success ? await loadInvoiceDetail(db, invoiceId) : undefined;
  if (!detail) {
    throw new InvoiceNotFoundError();
  }
  return detail;
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await loadOrThrow(req.params.id as string));
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

router.post(
  '/:id/lines/:lineId/review',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const result = await reviewInvoiceLine(
      db,
      actor.userAccountId,
      req.params.id as string,
      req.params.lineId as string,
      req.body,
    );
    res.json(result);
  }),
);

export default router;
