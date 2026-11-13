// Invoice overview (design K47): how many invoices are at each step of review,
// the first few at each, and the latest changes. Steps use the review queue's
// own filters (./reviewQueueBatches.ts), so "See all" lists the same invoices.
import { asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { invoice, invoiceEvent, invoiceEventTypes, professional, userAccount } from '../db/schema';
import { invoiceCaseNumber } from '../cases/caseNumberSql';
import { INVOICE_CHANGES, SENT_CODES } from '../cases/caseSummaries';
import { completionMarkedAt } from './invoiceEvents';
import { reviewerOf } from './queueSql';
import {
  AWAITING_MATCH_INVOICE_STATUS_CODE,
  AWAITING_SIGN_OFF_INVOICE_STATUS_CODE,
  DECIDED_INVOICE_STATUS_CODES,
  LINE_REVIEW_STATUS_CODES,
} from './invoiceStatusCodes';

export const OVERVIEW_STEPS = ['no_reviewer', 'being_reviewed', 'sign_off', 'not_completed'] as const;
export type OverviewStep = (typeof OVERVIEW_STEPS)[number];

const statusCode = sql<string>`(select code from invoice_statuses where id = ${invoice.statusId})`;
const statusIn = (codes: string[]) => sql`${statusCode} in (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})`;
const inLineReview = statusIn(LINE_REVIEW_STATUS_CODES);

// Waiting to be matched counts as having no reviewer yet: reviewers act on it (design J).
const STEP_WHERE: Record<OverviewStep, SQL> = {
  no_reviewer: sql`((${inLineReview} and ${reviewerOf} is null) or ${statusCode} = ${AWAITING_MATCH_INVOICE_STATUS_CODE})`,
  being_reviewed: sql`(${inLineReview} and ${reviewerOf} is not null)`,
  sign_off: sql`${statusCode} = ${AWAITING_SIGN_OFF_INVOICE_STATUS_CODE}`,
  not_completed: sql`(${statusIn(DECIDED_INVOICE_STATUS_CODES)} and ${completionMarkedAt} is null)`,
};

export interface OverviewInvoice {
  invoiceId: string;
  senderDisplayName: string | null;
  caseNumber: string | null;
  submittedTotal: string;
}

export interface InvoiceChange {
  invoiceId: string;
  senderDisplayName: string | null;
  caseNumber: string | null;
  periodStart: string | null;
  what: string;
  when: Date;
  by: string | null;
}

const senderName = sql<string | null>`coalesce(${professional.displayName}, ${userAccount.displayName})`;

function firstAt(db: DatabaseOrTransaction, step: OverviewStep, limit: number): Promise<OverviewInvoice[]> {
  return db
    .select({ invoiceId: invoice.invoiceId, senderDisplayName: senderName, caseNumber: invoiceCaseNumber, submittedTotal: invoice.submittedTotal })
    .from(invoice)
    .leftJoin(professional, eq(professional.professionalId, invoice.professionalId))
    .leftJoin(userAccount, eq(userAccount.userAccountId, invoice.submittedByUserAccountId))
    .where(STEP_WHERE[step])
    .orderBy(asc(invoice.submittedAt))
    .limit(limit);
}

export async function invoiceOverview(db: DatabaseOrTransaction, perStep = 3) {
  const [[counts], ...lists] = await Promise.all([
    db
      .select(Object.fromEntries(OVERVIEW_STEPS.map((step) => [step, sql<number>`(count(*) filter (where ${STEP_WHERE[step]}))::int`])) as Record<OverviewStep, SQL<number>>)
      .from(invoice),
    ...OVERVIEW_STEPS.map((step) => firstAt(db, step, perStep)),
  ]);
  return {
    steps: OVERVIEW_STEPS.map((step, index) => ({ step, count: counts?.[step] ?? 0, invoices: lists[index]! })),
  };
}

// The latest invoice events worth showing, as words.
export async function loadRecentInvoiceChanges(db: DatabaseOrTransaction, limit = 8): Promise<InvoiceChange[]> {
  const rows = await db
    .select({
      invoiceId: invoice.invoiceId,
      senderDisplayName: senderName,
      caseNumber: invoiceCaseNumber,
      periodStart: invoice.periodStart,
      code: invoiceEventTypes.code,
      when: invoiceEvent.occurredAt,
      by: sql<string | null>`(select display_name from user_account where user_account_id = ${invoiceEvent.actorUserAccountId})`,
      noReviewer: sql<boolean>`${inLineReview} and ${reviewerOf} is null`,
    })
    .from(invoiceEvent)
    .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
    .innerJoin(invoice, eq(invoiceEvent.invoiceId, invoice.invoiceId))
    .leftJoin(professional, eq(professional.professionalId, invoice.professionalId))
    .leftJoin(userAccount, eq(userAccount.userAccountId, invoice.submittedByUserAccountId))
    .where(inArray(invoiceEventTypes.code, Object.keys(INVOICE_CHANGES)))
    .orderBy(desc(invoiceEvent.occurredAt))
    .limit(limit);
  return rows.map(({ code, noReviewer, ...row }) => {
    const words = SENT_CODES.includes(code) && noReviewer ? 'sent, no reviewer yet' : code === 'matched_to_case' ? 'matched to its case' : INVOICE_CHANGES[code]!;
    return { ...row, what: words.charAt(0).toUpperCase() + words.slice(1) };
  });
}
