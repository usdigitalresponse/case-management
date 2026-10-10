// One invoice with its lines and current decisions, shared by staff review,
// the portal and exports. Callers check access first.
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  caseTable,
  invoice,
  invoiceApprovalChain,
  invoiceApprovalDecision,
  invoiceApprovalOutcomes,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  person,
  professional,
  timeEntry,
  userAccount,
} from '../db/schema';

export function selectInvoiceHeaders(db: Database) {
  return db
    .select({
      invoiceId: invoice.invoiceId,
      caseId: invoice.caseId,
      caseClientDisplayName: person.displayName,
      caseExternalReference: caseTable.externalReference,
      professionalId: invoice.professionalId,
      professionalDisplayName: professional.displayName,
      submittedByUserAccountId: invoice.submittedByUserAccountId,
      submittedByDisplayName: userAccount.displayName,
      statusId: invoice.statusId,
      statusCode: invoiceStatuses.code,
      statusDisplayName: invoiceStatuses.displayName,
      submittedAt: invoice.submittedAt,
      submittedTotal: invoice.submittedTotal,
      currencyCode: invoice.currencyCode,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
    })
    .from(invoice)
    .leftJoin(caseTable, eq(invoice.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .leftJoin(professional, eq(invoice.professionalId, professional.professionalId))
    .leftJoin(userAccount, eq(invoice.submittedByUserAccountId, userAccount.userAccountId))
    .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id));
}

export type InvoiceHeader = Awaited<ReturnType<typeof selectInvoiceHeaders>>[number];

export async function loadInvoiceLines(db: Database, invoiceId: string) {
  // Decisions from the current (non-superseded) chain.
  return db
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      amount: invoiceLine.amount,
      serviceDate: invoiceLine.serviceDate,
      description: invoiceLine.description,
      quantity: invoiceLine.quantity,
      unitRate: invoiceLine.unitRate,
      timekeeperLabel: invoiceLine.timekeeperLabel,
      timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId,
      timekeeperDisplayName: professional.displayName,
      taskCode: invoiceLine.taskCode,
      activityCode: invoiceLine.activityCode,
      expenseCode: invoiceLine.expenseCode,
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
    .leftJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
    .leftJoin(professional, eq(invoiceLine.timekeeperProfessionalId, professional.professionalId))
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
    .orderBy(asc(invoiceLine.serviceDate), asc(timeEntry.activityOn), asc(invoiceLine.invoiceLineId));
}

export type InvoiceDetailLine = Awaited<ReturnType<typeof loadInvoiceLines>>[number];

export interface SubmissionAttempt {
  invoiceApprovalChainId: string;
  submittedAt: Date;
}

export interface InvoiceDetail {
  invoice: InvoiceHeader;
  lines: InvoiceDetailLine[];
  // Null for drafts.
  submissionAttempt: SubmissionAttempt | null;
}

export async function loadInvoiceDetail(db: Database, invoiceId: string): Promise<InvoiceDetail | undefined> {
  const [header] = await selectInvoiceHeaders(db).where(eq(invoice.invoiceId, invoiceId));
  if (!header) {
    return undefined;
  }
  const [lines, [attempt]] = await Promise.all([
    loadInvoiceLines(db, invoiceId),
    db
      .select({
        invoiceApprovalChainId: invoiceApprovalChain.invoiceApprovalChainId,
        submittedAt: invoiceApprovalChain.createdAt,
      })
      .from(invoiceApprovalChain)
      .where(and(eq(invoiceApprovalChain.invoiceId, invoiceId), isNull(invoiceApprovalChain.supersededAt))),
  ]);
  return { invoice: header, lines, submissionAttempt: attempt ?? null };
}
