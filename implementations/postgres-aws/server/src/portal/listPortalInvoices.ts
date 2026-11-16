// The portal's invoice list, a batch at a time, with what the submitter needs at a glance, each loaded for all
// rows at once.
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { groupBy } from '../groupBy';
import { afterCursor, cursorColumn, newestFirst, oneBatch, orderByKeys, sortKey, withoutCursor, type BatchRequest, type SortKey } from '../lists/batches';
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
import { DECIDED_INVOICE_STATUS_CODES, DRAFT_INVOICE_STATUS_CODE, IN_REVIEW_INVOICE_STATUS_CODES, WITHDRAWN_INVOICE_STATUS_CODE } from '../billing/invoiceStatusCodes';
import { returnedReason } from '../billing/invoiceEvents';

// Drafts first (the newest work), then the most recently sent.
const IN_LIST_ORDER: SortKey[] = [
  sortKey(sql`(${invoice.submittedAt} is not null)::int`, 'integer'),
  newestFirst(invoice.submittedAt),
  sortKey(sql`${invoice.invoiceId}`, 'uuid'),
];

function selectPortalInvoices(db: Database, reader: PortalActor) {
  return db
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
      proposedCase: invoice.proposedCase,
      caseNumberAsTyped: invoice.caseNumberAsTyped,
      caseNumberCorrected: invoice.caseNumberCorrected,
      returnedReason,
      cursor: cursorColumn(IN_LIST_ORDER),
    })
    .from(invoice)
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId));
}

export async function listPortalInvoices(db: Database, reader: PortalActor, caseId?: string) {
  const conditions = [portalReadableInvoiceCondition(db, reader)];
  if (caseId) {
    conditions.push(eq(invoice.caseId, caseId));
  }
  const rows = await selectPortalInvoices(db, reader).where(and(...conditions)).orderBy(...orderByKeys(IN_LIST_ORDER));
  return describePortalInvoices(db, rows.map(withoutCursor));
}

// list: all but withdrawn and sent-back ones (the summary's); current: all but withdrawn;
// all: withdrawn too; case_drafts: drafts with a case.
export const PORTAL_INVOICE_SHOWS = ['list', 'current', 'all', 'case_drafts'] as const;
export type PortalInvoiceShow = (typeof PORTAL_INVOICE_SHOWS)[number];

const withdrawn = sql`${invoiceStatuses.code} = ${WITHDRAWN_INVOICE_STATUS_CODE}`;

// A batch at a time (../lists/batches.ts); on the first, those sent back to change and how many were withdrawn.
export async function listPortalInvoiceBatch(db: Database, reader: PortalActor, request: { caseId?: string; show?: PortalInvoiceShow }, batch: BatchRequest) {
  const base = and(portalReadableInvoiceCondition(db, reader), request.caseId ? eq(invoice.caseId, request.caseId) : undefined);
  const show = request.show ?? 'list';
  const shown =
    show === 'case_drafts'
      ? and(eq(invoiceStatuses.code, DRAFT_INVOICE_STATUS_CODE), isNotNull(invoice.caseId))
      : show === 'all'
        ? undefined
        : show === 'current'
          ? sql`not ${withdrawn}`
          : and(sql`not ${withdrawn}`, sql`${returnedReason} is null`);
  const { rows, next } = await oneBatch(batch, (after, limit) =>
    selectPortalInvoices(db, reader).where(and(base, shown, afterCursor(IN_LIST_ORDER, after))).orderBy(...orderByKeys(IN_LIST_ORDER)).limit(limit),
  );
  const items = await describePortalInvoices(db, rows);
  if (batch.after) return { items, next };
  const [returned, [counted]] = await Promise.all([
    show === 'list'
      ? selectPortalInvoices(db, reader).where(and(base, sql`not ${withdrawn}`, sql`${returnedReason} is not null`)).orderBy(...orderByKeys(IN_LIST_ORDER))
      : Promise.resolve([] as Awaited<ReturnType<ReturnType<typeof selectPortalInvoices>['where']>>),
    db.select({ withdrawn: sql<number>`count(*)::int` }).from(invoice).innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id)).where(and(base, withdrawn)),
  ]);
  return { items, next, summary: { needsChanges: await describePortalInvoices(db, returned.map(withoutCursor)), withdrawn: counted!.withdrawn } };
}

// The case number, a draft's import and changes, the reviewer while in review, and the outcome once decided.
async function describePortalInvoices(db: Database, rows: Array<Omit<Awaited<ReturnType<ReturnType<typeof selectPortalInvoices>['where']>>[number], 'cursor'>>) {
  const ids = (codes: readonly string[]) => rows.filter((row) => codes.includes(row.statusCode)).map((row) => row.invoiceId);
  const draftIds = ids([DRAFT_INVOICE_STATUS_CODE]);
  const decidedIds = ids(DECIDED_INVOICE_STATUS_CODES);
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
  const linesFor = groupBy(lines, (line) => line.invoiceId);
  const linesOf = (invoiceId: string) => linesFor.get(invoiceId) ?? [];
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
