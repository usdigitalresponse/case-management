// A case's stage on the overview and list, derived from its invoices; the first that matches:
//   needs-assignment  an invoice is waiting and no reviewer is assigned to it
//   billing           an invoice is waiting for review or sign-off
//   closing           an approved invoice is waiting on the close action
//   represented       everything else still open: no invoice waiting
// A closed case (closed_on set) has no stage — it has left the board.
import { sql, type SQL } from 'drizzle-orm';
import { caseTable, invoice, invoiceApprovalStepTypes, invoiceReviewAssignment, invoiceStatuses } from '../db/schema';
import { APPROVED_INVOICE_STATUS_CODE, IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';
import { LINE_REVIEW_STEP_TYPE_CODE } from '../billing/reviewAssignment';

export const CASE_STAGES = ['needs-assignment', 'represented', 'billing', 'closing'] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

const WAITING = sql.join(IN_REVIEW_INVOICE_STATUS_CODES.map((code) => sql`${code}`), sql`, `);
// Needs `invoice` in scope.
export const hasLineReviewer = sql<boolean>`exists (
  select 1 from ${invoiceReviewAssignment}
  inner join ${invoiceApprovalStepTypes} on ${invoiceApprovalStepTypes.id} = ${invoiceReviewAssignment.stepTypeId}
  where ${invoiceReviewAssignment.invoiceId} = ${invoice.invoiceId} and ${invoiceReviewAssignment.endedAt} is null
    and ${invoiceApprovalStepTypes.code} = ${LINE_REVIEW_STEP_TYPE_CODE}
)`;

export const caseStageExpression: SQL<CaseStage | null> = sql<CaseStage | null>`
  case
    when ${caseTable.closedOn} is not null then null
    when exists (
      select 1 from ${invoice}
      inner join ${invoiceStatuses} on ${invoiceStatuses.id} = ${invoice.statusId}
      where ${invoice.caseId} = ${caseTable.caseId} and ${invoiceStatuses.code} in (${WAITING}) and not ${hasLineReviewer}
    ) then 'needs-assignment'
    when exists (
      select 1 from ${invoice}
      inner join ${invoiceStatuses} on ${invoiceStatuses.id} = ${invoice.statusId}
      where ${invoice.caseId} = ${caseTable.caseId} and ${invoiceStatuses.code} in (${WAITING})
    ) then 'billing'
    when exists (
      select 1 from ${invoice}
      inner join ${invoiceStatuses} on ${invoiceStatuses.id} = ${invoice.statusId}
      where ${invoice.caseId} = ${caseTable.caseId} and ${invoiceStatuses.code} = ${APPROVED_INVOICE_STATUS_CODE}
    ) then 'closing'
    else 'represented'
  end
`;
