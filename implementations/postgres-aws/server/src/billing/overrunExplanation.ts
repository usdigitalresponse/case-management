// model/rules.yaml explain_preauthorization_overrun: recorded once with the attempt, never exported.
import { asc, eq } from 'drizzle-orm';
import type { DatabaseOrTransaction, Transaction } from '../db/client';
import { invoice, invoiceOverrunExplanation, userAccount } from '../db/schema';
import { ValidationError } from '../errors';
import { formatMoney, fromCents, toCents } from './money';
import { loadPreauthorizationSummaries, summaryForProfessional } from './preauthorizations';

export interface Overrun {
  professionalId: string | null;
  limit: string;
  source: 'preauthorized' | 'threshold';
  // Approved and waiting for the professional on the case, with this invoice.
  total: string;
}

// thisInvoiceCounted: the invoice is already submitted, so in "waiting".
export async function findOverrun(
  db: DatabaseOrTransaction,
  invoiceId: string,
  thisInvoiceCounted: boolean,
): Promise<Overrun | null> {
  const [row] = await db
    .select({ caseId: invoice.caseId, professionalId: invoice.professionalId, total: invoice.submittedTotal })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId));
  if (!row?.caseId) return null;
  const summaries = await loadPreauthorizationSummaries(db, row.caseId, row.professionalId ? [row.professionalId] : []);
  const summary = summaryForProfessional(summaries, row.professionalId);
  if (!summary) return null;
  const total = toCents(summary.approvedSoFar) + toCents(summary.waiting) + (thisInvoiceCounted ? 0 : toCents(row.total));
  if (total <= toCents(summary.ceiling)) return null;
  return { professionalId: summary.professionalId, limit: summary.ceiling, source: summary.source, total: fromCents(total) };
}

export function overrunMessage(overrun: Overrun): string {
  const limit = overrun.source === 'threshold' ? 'threshold' : 'pre-authorized';
  return `This takes the provider to ${formatMoney(overrun.total)} on this case, over the ${formatMoney(overrun.limit)} ${limit}. Explain why more wasn't pre-authorized.`;
}

// Runs after the attempt exists, so its total is final. Optional for staff entering one received elsewhere.
export async function requireOverrunExplanation(
  tx: Transaction,
  args: { invoiceId: string; chainId: string; actorUserAccountId: string; explanation: string | undefined; required: boolean },
): Promise<void> {
  const overrun = await findOverrun(tx, args.invoiceId, true);
  if (!overrun) return;
  const explanation = args.explanation?.trim();
  if (!explanation) {
    if (args.required) throw new ValidationError({ overrunExplanation: overrunMessage(overrun) });
    return;
  }
  const [row] = await tx.select({ professionalId: invoice.professionalId }).from(invoice).where(eq(invoice.invoiceId, args.invoiceId));
  await tx.insert(invoiceOverrunExplanation).values({
    invoiceId: args.invoiceId,
    invoiceApprovalChainId: args.chainId,
    professionalId: overrun.professionalId ?? row!.professionalId!,
    limitAmount: overrun.limit,
    limitSource: overrun.source,
    totalWithRequest: overrun.total,
    explanation: explanation.slice(0, 4000),
    recordedByUserAccountId: args.actorUserAccountId,
    recordedAt: new Date(),
  });
}

export interface OverrunExplanationView {
  limit: string;
  source: string;
  total: string;
  explanation: string;
  recordedBy: string | null;
  recordedAt: Date;
}

export async function loadOverrunExplanations(db: DatabaseOrTransaction, invoiceId: string): Promise<OverrunExplanationView[]> {
  return db
    .select({
      limit: invoiceOverrunExplanation.limitAmount,
      source: invoiceOverrunExplanation.limitSource,
      total: invoiceOverrunExplanation.totalWithRequest,
      explanation: invoiceOverrunExplanation.explanation,
      recordedBy: userAccount.displayName,
      recordedAt: invoiceOverrunExplanation.recordedAt,
    })
    .from(invoiceOverrunExplanation)
    .leftJoin(userAccount, eq(invoiceOverrunExplanation.recordedByUserAccountId, userAccount.userAccountId))
    .where(eq(invoiceOverrunExplanation.invoiceId, invoiceId))
    .orderBy(asc(invoiceOverrunExplanation.recordedAt));
}
