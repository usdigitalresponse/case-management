// Cross-case invoice listing (today, scoped to the billing review queue)
// and the review action itself — the staff-facing counterpart to
// ../portal/createInvoice.ts. Unlike ../routes/cases.ts's
// GET /:id/invoices (one case), this lists across every case, which is
// what a review queue needs.
import { Router } from 'express';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { invoice, invoiceStatuses, caseTable, person, professional } from '../db/schema';
import { getSessionUser, requireFullUser } from '../auth/session';
import {
  reviewInvoice,
  ReviewInvoiceValidationError,
  InvoiceNotFoundError,
  InvoiceNotSubmittedError,
  ReviewInvoiceConfigurationError,
} from '../billing/reviewInvoice';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters: SQL[] = [];
    if (typeof req.query.status === 'string') {
      const [status] = await db.select({ id: invoiceStatuses.id }).from(invoiceStatuses).where(eq(invoiceStatuses.code, req.query.status));
      if (!status) {
        res.json({ invoices: [] });
        return;
      }
      filters.push(eq(invoice.statusId, status.id));
    }

    const rows = await db
      .select({
        invoiceId: invoice.invoiceId,
        caseId: invoice.caseId,
        caseClientDisplayName: person.displayName,
        caseExternalReference: caseTable.externalReference,
        professionalId: invoice.professionalId,
        professionalDisplayName: professional.displayName,
        statusId: invoice.statusId,
        statusDisplayName: invoiceStatuses.displayName,
        submittedAt: invoice.submittedAt,
        submittedTotal: invoice.submittedTotal,
      })
      .from(invoice)
      .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
      .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(invoice.submittedAt));
    res.json({ invoices: rows });
  }),
);

router.post(
  '/:id/review',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const invoiceId = req.params.id as string;
    try {
      const result = await reviewInvoice(db, actor.userAccountId, invoiceId, req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof ReviewInvoiceValidationError) {
        res.status(400).json({ error: 'validation_error', fieldErrors: error.fieldErrors });
        return;
      }
      if (error instanceof InvoiceNotFoundError) {
        res.status(404).json({ error: 'not_found', message: error.message });
        return;
      }
      if (error instanceof InvoiceNotSubmittedError) {
        res.status(409).json({ error: 'invalid_state', message: error.message });
        return;
      }
      if (error instanceof ReviewInvoiceConfigurationError) {
        res.status(500).json({ error: 'configuration_error', message: error.message });
        return;
      }
      throw error;
    }
  }),
);

export default router;
