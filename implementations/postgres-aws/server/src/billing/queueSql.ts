// The review queue's derived columns in SQL, per invoice row, for filtering,
// counting and sorting in the database. Each matches its code in
// ./reviewRounds.ts and ./reviewAssignment.ts: change both together. "the queue
// a batch at a time" in __tests__/reviewInvoiceLine.test.ts checks they agree.
import { sql, type SQL } from 'drizzle-orm';
import { invoice } from '../db/schema';
import { LINE_REVIEW_STEP_TYPE_CODE, SIGN_OFF_STEP_TYPE_CODE } from './reviewAssignment';
import { AWAITING_SIGN_OFF_INVOICE_STATUS_CODE } from './invoiceStatusCodes';

const stepType = (code: string) => sql`(select id from invoice_approval_step_types where code = ${code})`;

const currentChain = sql`(select c.invoice_approval_chain_id from invoice_approval_chain c
  where c.invoice_id = ${invoice.invoiceId} and c.superseded_at is null limit 1)`;

// latestRoundNumber: the latest sequence at which every line was decided.
export const latestRound: SQL<number | null> = sql<number | null>`(select max(r.sequence_number) from (
  select d.sequence_number from invoice_approval_decision d
  where d.invoice_approval_chain_id = ${currentChain} and d.step_type_id = ${stepType(LINE_REVIEW_STEP_TYPE_CODE)}
  group by d.sequence_number
  having count(*) >= (select count(*) from invoice_line l where l.invoice_id = ${invoice.invoiceId})
    and exists (select 1 from invoice_line l where l.invoice_id = ${invoice.invoiceId})) r)`;

// When the latest round's line review finished.
export const finishedAt: SQL<string | null> = sql<string | null>`(select max(d.decided_at) from invoice_approval_decision d
  where d.invoice_approval_chain_id = ${currentChain} and d.step_type_id = ${stepType(LINE_REVIEW_STEP_TYPE_CODE)}
    and d.sequence_number = ${latestRound})`;

export const reviewerOf: SQL<string | null> = sql<string | null>`(select a.assigned_user_account_id from invoice_review_assignment a
  where a.invoice_id = ${invoice.invoiceId} and a.ended_at is null and a.step_type_id = ${stepType(LINE_REVIEW_STEP_TYPE_CODE)}
  order by a.position limit 1)`;

// signOffProgress's next approver: the first not to approve since the round.
const nextApprover = sql<string | null>`(select a.assigned_user_account_id from invoice_review_assignment a
  where a.invoice_id = ${invoice.invoiceId} and a.ended_at is null and a.step_type_id = ${stepType(SIGN_OFF_STEP_TYPE_CODE)}
    and not exists (select 1 from invoice_approval_decision d
      join invoice_approval_outcomes o on o.id = d.outcome_id and o.code = 'approved'
      where d.invoice_approval_chain_id = ${currentChain} and d.step_type_id = ${stepType(SIGN_OFF_STEP_TYPE_CODE)}
        and d.decided_by_user_account_id = a.assigned_user_account_id and d.sequence_number > ${latestRound})
  order by a.position limit 1)`;

// Who must act now: the next approver while awaiting sign-off, else the reviewer.
export function holderOf(statusCode: SQL | unknown): SQL<string | null> {
  return sql<string | null>`case when ${statusCode} = ${AWAITING_SIGN_OFF_INVOICE_STATUS_CODE}
    then coalesce(${nextApprover}, ${reviewerOf}) else ${reviewerOf} end`;
}

// approvedTotal: the latest round's approved lines; nothing once rejected at sign-off; null before a round.
export const approvedTotalOf: SQL<string | null> = sql<string | null>`(case
  when ${latestRound} is null then null
  when exists (select 1 from invoice_approval_decision d
    join invoice_approval_outcomes o on o.id = d.outcome_id and o.code = 'rejected'
    where d.invoice_approval_chain_id = ${currentChain} and d.step_type_id = ${stepType(SIGN_OFF_STEP_TYPE_CODE)}
      and d.sequence_number > ${latestRound}) then 0
  else (select coalesce(sum(d.approved_amount), 0) from invoice_approval_decision d
    where d.invoice_approval_chain_id = ${currentChain} and d.sequence_number = ${latestRound} and d.invoice_line_id is not null)
  end)`;
