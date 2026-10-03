// Where a case sits in its working lifecycle, derived from its actual
// state rather than stored — there's no "stage" column anywhere; this
// infers one from case_assignment/invoice/case.closed_on so the overview
// board (client/src/pages/Overview.tsx) can bucket real cases into real
// columns instead of a hardcoded placeholder.
//
// Buckets are checked in this order, so a case lands in the first one
// that matches. Billing comes before closing so a later invoice awaiting
// review isn't hidden by an earlier approved one:
//   billing              a submitted invoice is waiting on staff review
//   closing              an approved invoice is waiting on the close action
//   represented          an open (not-yet-ended) assignment exists
//   awaiting-assignment  everything else still open
// A closed case (closed_on set) has no stage — it has left the board.
import { sql, type SQL } from 'drizzle-orm';
import { caseTable, caseAssignment, invoice, invoiceStatuses } from '../db/schema';
import { APPROVED_INVOICE_STATUS_CODE, SUBMITTED_INVOICE_STATUS_CODE } from '../billing/invoiceStatusCodes';

export const CASE_STAGES = ['awaiting-assignment', 'represented', 'billing', 'closing'] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const caseStageExpression: SQL<CaseStage | null> = sql<CaseStage | null>`
  case
    when ${caseTable.closedOn} is not null then null
    when exists (
      select 1 from ${invoice}
      inner join ${invoiceStatuses} on ${invoiceStatuses.id} = ${invoice.statusId}
      where ${invoice.caseId} = ${caseTable.caseId} and ${invoiceStatuses.code} = ${SUBMITTED_INVOICE_STATUS_CODE}
    ) then 'billing'
    when exists (
      select 1 from ${invoice}
      inner join ${invoiceStatuses} on ${invoiceStatuses.id} = ${invoice.statusId}
      where ${invoice.caseId} = ${caseTable.caseId} and ${invoiceStatuses.code} = ${APPROVED_INVOICE_STATUS_CODE}
    ) then 'closing'
    when exists (
      select 1 from ${caseAssignment}
      where ${caseAssignment.caseId} = ${caseTable.caseId} and ${caseAssignment.endedAt} is null
    ) then 'represented'
    else 'awaiting-assignment'
  end
`;
