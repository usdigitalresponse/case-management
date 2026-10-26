import type { LineDecision } from './api/client';
import { cents } from './formatMoney';

export interface ReviewTotals {
  decided: number;
  // In cents.
  approved: number;
  cut: number;
  counts: { approved: number; part: number; rejected: number };
}

// What has been decided so far: approved, cut from the decided lines, and
// how many lines had each outcome.
export function reviewTotals<L extends { amount: string }>(lines: L[], decisionOf: (line: L) => LineDecision | null): ReviewTotals {
  const totals: ReviewTotals = { decided: 0, approved: 0, cut: 0, counts: { approved: 0, part: 0, rejected: 0 } };
  for (const line of lines) {
    const decision = decisionOf(line);
    if (!decision) continue;
    const approved = cents(decision.approvedAmount);
    totals.decided += 1;
    totals.approved += approved;
    totals.cut += cents(line.amount) - approved;
    totals.counts[decision.outcomeCode === 'approved_in_part' ? 'part' : decision.outcomeCode] += 1;
  }
  return totals;
}

// "Name", or "Name, sent by Delegate" when someone else submitted it.
export function submittedByLabel(invoice: { professionalDisplayName: string | null; submittedByDisplayName: string | null }): string {
  const name = invoice.professionalDisplayName ?? 'Unknown';
  return invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName
    ? `${name}, sent by ${invoice.submittedByDisplayName}`
    : name;
}
