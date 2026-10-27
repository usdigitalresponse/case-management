// The portal's invoice list, with deletability, the last submission time
// (recall clears submittedAt) and what the submitter needs at a glance:
// the case number, a draft's import and changes, the reviewer while in
// review, and the outcome once decided. Each is loaded for all rows at once.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  caseTable,
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  person,
  professional,
} from '../db/schema';
import { portalReadableInvoiceCondition } from '../billing/invoiceAccess';
import type { PortalActor } from './portalActor';
import { deletableBy } from '../billing/deleteInvoice';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { loadLineReviewerNames } from '../billing/reviewAssignment';
import { approvedTotal, latestRoundNumber, loadRecordedDecisionsByChain, type RecordedDecision } from '../billing/reviewRounds';
import { toCents } from '../billing/money';
import { loadFileSources, submitterChanges } from '../imports/invoiceFile';
import {
  APPROVED_INVOICE_STATUS_CODE,
  DRAFT_INVOICE_STATUS_CODE,
  IN_REVIEW_INVOICE_STATUS_CODES,
  REJECTED_INVOICE_STATUS_CODE,
} from '../billing/invoiceStatusCodes';

const DECIDED_STATUS_CODES = [APPROVED_INVOICE_STATUS_CODE, REJECTED_INVOICE_STATUS_CODE];

export async function listPortalInvoices(db: Database, reader: PortalActor, caseId?: string) {
  const conditions = [portalReadableInvoiceCondition(db, reader)];
  if (caseId) {
    conditions.push(eq(invoice.caseId, caseId));
  }
  const rows = await db
    .select({
      invoiceId: invoice.invoiceId,
      caseId: invoice.caseId,
      statusId: invoice.statusId,
      statusCode: invoiceStatuses.code,
      statusDisplayName: invoiceStatuses.displayName,
      submittedAt: invoice.submittedAt,
      submittedTotal: invoice.submittedTotal,
      submittedByUserAccountId: invoice.submittedByUserAccountId,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      lastSubmittedAt: sql<Date | null>`(select max(${invoiceApprovalChain.createdAt}) from ${invoiceApprovalChain} where ${invoiceApprovalChain.invoiceId} = ${invoice.invoiceId})`.mapWith(invoiceApprovalChain.createdAt),
      deletable: deletableBy(reader.userAccountId),
      // For the submitter's start page, across cases.
      caseClientDisplayName: person.displayName,
      caseExternalReference: caseTable.externalReference,
      professionalDisplayName: professional.displayName,
    })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .where(and(...conditions))
    .orderBy(desc(invoice.submittedAt));

  const ids = (codes: readonly string[]) => rows.filter((row) => codes.includes(row.statusCode)).map((row) => row.invoiceId);
  const draftIds = ids([DRAFT_INVOICE_STATUS_CODE]);
  const decidedIds = ids(DECIDED_STATUS_CODES);
  const [caseNumbers, sources, reviewers, chains] = await Promise.all([
    loadCaseNumbers(db, [...new Set(rows.map((row) => row.caseId))]),
    loadFileSources(db, draftIds),
    // Shown to the submitter while their invoice is in review.
    loadLineReviewerNames(db, ids(IN_REVIEW_INVOICE_STATUS_CODES)),
    decidedIds.length === 0
      ? []
      : db
          .select({ invoiceId: invoiceApprovalChain.invoiceId, chainId: invoiceApprovalChain.invoiceApprovalChainId })
          .from(invoiceApprovalChain)
          .where(and(inArray(invoiceApprovalChain.invoiceId, decidedIds), isNull(invoiceApprovalChain.supersededAt))),
  ]);
  const lineIds = [...sources.keys(), ...decidedIds];
  const [lines, decisions] = await Promise.all([
    lineIds.length === 0
      ? []
      : db
          .select({
            invoiceId: invoiceLine.invoiceId,
            invoiceLineId: invoiceLine.invoiceLineId,
            sourceLocation: invoiceLine.sourceLocation,
            lineTypeCode: invoiceLineTypes.code,
            expenseTypeCode: expenseTypes.code,
            serviceDate: invoiceLine.serviceDate,
            description: invoiceLine.description,
            quantity: invoiceLine.quantity,
            unitRate: invoiceLine.unitRate,
            amount: invoiceLine.amount,
          })
          .from(invoiceLine)
          .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
          .leftJoin(expenseTypes, eq(invoiceLine.expenseTypeId, expenseTypes.id))
          .where(inArray(invoiceLine.invoiceId, lineIds)),
    loadRecordedDecisionsByChain(db, chains.map((chain) => chain.chainId)),
  ]);
  const linesOf = (invoiceId: string) => lines.filter((line) => line.invoiceId === invoiceId);
  const chainOf = new Map(chains.map((chain) => [chain.invoiceId, chain.chainId]));

  return rows.map((row) => {
    const source = sources.get(row.invoiceId);
    const chainId = chainOf.get(row.invoiceId);
    const outcome = chainId ? decidedOutcome(decisions.get(chainId) ?? [], linesOf(row.invoiceId)) : null;
    return {
      ...row,
      caseNumber: caseNumbers.get(row.caseId)?.caseNumber ?? null,
      // The import a draft was read from, if any.
      import: source ? { invoiceImportId: source.invoiceImportId, statusCode: source.importStatusCode } : null,
      // A draft's changes from its file so far.
      changes: source ? submitterChanges(source, linesOf(row.invoiceId)) : null,
      reviewerDisplayName: reviewers.get(row.invoiceId) ?? null,
      approvedTotal: outcome?.approvedTotal ?? null,
      cutLineCount: outcome?.cutLineCount ?? null,
    };
  });
}

// What the latest finished round approved, and how many lines it cut in
// part or in full.
function decidedOutcome(recorded: RecordedDecision[], lines: Array<{ invoiceLineId: string; amount: string }>) {
  const round = latestRoundNumber(recorded, lines.length);
  const requested = new Map(lines.map((line) => [line.invoiceLineId, toCents(line.amount)]));
  const cutLineCount = recorded.filter(
    (decision) =>
      decision.sequenceNumber === round &&
      decision.invoiceLineId !== null &&
      toCents(decision.approvedAmount) < (requested.get(decision.invoiceLineId) ?? 0),
  ).length;
  return { approvedTotal: approvedTotal(recorded, round), cutLineCount: round === null ? null : cutLineCount };
}
