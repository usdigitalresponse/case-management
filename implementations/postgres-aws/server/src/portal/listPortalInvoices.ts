// The portal's invoice list, with deletability, the last submission time
// (recall clears submittedAt) and what the submitter needs at a glance:
// the case number, an unchecked import, the reviewer while in review, and
// the outcome once decided.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  caseTable,
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceImport,
  invoiceImportStatuses,
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
import { loadAssignments } from '../billing/reviewAssignment';
import { approvedTotal, latestRoundNumber, loadRecordedDecisions } from '../billing/reviewRounds';
import { toCents } from '../billing/money';
import { loadFileSource, submitterChanges } from '../imports/invoiceFile';
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

  const draftIds = rows.filter((row) => row.statusCode === DRAFT_INVOICE_STATUS_CODE).map((row) => row.invoiceId);
  const [caseNumbers, imports] = await Promise.all([
    loadCaseNumbers(db, [...new Set(rows.map((row) => row.caseId))]),
    draftIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ invoiceId: invoiceImport.invoiceId, invoiceImportId: invoiceImport.invoiceImportId, statusCode: invoiceImportStatuses.code })
          .from(invoiceImport)
          .innerJoin(invoiceImportStatuses, eq(invoiceImport.statusId, invoiceImportStatuses.id))
          .where(inArray(invoiceImport.invoiceId, draftIds)),
  ]);
  const importFor = new Map(imports.map(({ invoiceId, ...rest }) => [invoiceId, rest]));

  return Promise.all(
    rows.map(async (row) => {
      const inReview = IN_REVIEW_INVOICE_STATUS_CODES.includes(row.statusCode);
      const decided = DECIDED_STATUS_CODES.includes(row.statusCode);
      // Shown to the submitter while their invoice is in review.
      const reviewer = inReview ? (await loadAssignments(db, row.invoiceId)).reviewer : null;
      const outcome = decided ? await decidedOutcome(db, row.invoiceId) : null;
      const imported = importFor.get(row.invoiceId) ?? null;
      return {
        ...row,
        caseNumber: caseNumbers.get(row.caseId)?.caseNumber ?? null,
        // The import a draft was read from, if any.
        import: imported,
        // A draft's changes from its file so far.
        changes: imported ? await draftChanges(db, row.invoiceId) : null,
        reviewerDisplayName: reviewer?.displayName ?? null,
        approvedTotal: outcome?.approvedTotal ?? null,
        cutLineCount: outcome?.cutLineCount ?? null,
      };
    }),
  );
}

async function draftChanges(db: Database, invoiceId: string) {
  const source = await loadFileSource(db, invoiceId);
  if (!source) {
    return null;
  }
  const lines = await db
    .select({
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
    .where(eq(invoiceLine.invoiceId, invoiceId));
  return submitterChanges(source, lines);
}

// What the latest finished round approved, and how many lines it cut in
// part or in full.
async function decidedOutcome(db: Database, invoiceId: string) {
  const [chain] = await db
    .select({ chainId: invoiceApprovalChain.invoiceApprovalChainId })
    .from(invoiceApprovalChain)
    .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt)));
  if (!chain) {
    return null;
  }
  const [recorded, lines] = await Promise.all([
    loadRecordedDecisions(db, chain.chainId),
    db.select({ invoiceLineId: invoiceLine.invoiceLineId, amount: invoiceLine.amount }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)),
  ]);
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
