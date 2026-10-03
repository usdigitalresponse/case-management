// Staff invoice review: the cross-case queue, one invoice's lines with
// their decisions, and line review.
import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import {
  invoice,
  invoiceLine,
  invoiceStatuses,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalOutcomes,
  caseTable,
  person,
  professional,
  timeEntry,
  userAccount,
} from '../db/schema';
import { getSessionUser, requireFullUser } from '../auth/session';
import { InvoiceNotFoundError, reviewInvoiceLine } from '../billing/reviewInvoiceLine';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

function selectInvoiceHeaders() {
  return db
    .select({
      invoiceId: invoice.invoiceId,
      caseId: invoice.caseId,
      caseClientDisplayName: person.displayName,
      caseExternalReference: caseTable.externalReference,
      professionalId: invoice.professionalId,
      professionalDisplayName: professional.displayName,
      statusId: invoice.statusId,
      statusCode: invoiceStatuses.code,
      statusDisplayName: invoiceStatuses.displayName,
      submittedAt: invoice.submittedAt,
      submittedTotal: invoice.submittedTotal,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
    })
    .from(invoice)
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id));
}

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

    const rows = await selectInvoiceHeaders()
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(invoice.submittedAt));
    res.json({ invoices: rows });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const invoiceId = req.params.id as string;
    const [header] = z.uuid().safeParse(invoiceId).success
      ? await selectInvoiceHeaders().where(eq(invoice.invoiceId, invoiceId))
      : [];
    if (!header) {
      throw new InvoiceNotFoundError();
    }

    // Decisions come from the invoice's current (non-superseded) chain.
    const lines = await db
      .select({
        invoiceLineId: invoiceLine.invoiceLineId,
        amount: invoiceLine.amount,
        sourceTimeEntryId: invoiceLine.sourceTimeEntryId,
        sourceActivityOn: timeEntry.activityOn,
        sourceDurationHours: timeEntry.durationHours,
        sourceDescription: timeEntry.description,
        decisionOutcomeCode: invoiceApprovalOutcomes.code,
        decisionOutcomeDisplayName: invoiceApprovalOutcomes.displayName,
        decisionApprovedAmount: invoiceApprovalDecision.approvedAmount,
        decisionReason: invoiceApprovalDecision.reason,
        decidedByDisplayName: userAccount.displayName,
        decidedAt: invoiceApprovalDecision.decidedAt,
      })
      .from(invoiceLine)
      .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
      .leftJoin(
        invoiceApprovalChain,
        and(eq(invoiceApprovalChain.invoiceId, invoiceLine.invoiceId), isNull(invoiceApprovalChain.supersededAt)),
      )
      .leftJoin(
        invoiceApprovalDecision,
        and(
          eq(invoiceApprovalDecision.invoiceApprovalChainId, invoiceApprovalChain.invoiceApprovalChainId),
          eq(invoiceApprovalDecision.invoiceLineId, invoiceLine.invoiceLineId),
        ),
      )
      .leftJoin(invoiceApprovalOutcomes, eq(invoiceApprovalDecision.outcomeId, invoiceApprovalOutcomes.id))
      .leftJoin(userAccount, eq(invoiceApprovalDecision.decidedByUserAccountId, userAccount.userAccountId))
      .where(eq(invoiceLine.invoiceId, invoiceId))
      .orderBy(asc(timeEntry.activityOn), asc(invoiceLine.invoiceLineId));
    res.json({ invoice: header, lines });
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
