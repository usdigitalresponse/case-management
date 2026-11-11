import { describe, expect, it } from 'vitest';
import type { InvoiceReview, InvoiceReviewLine } from '../../api/client';
import { reviewFacts } from './reviewFacts';

const decided = { outcomeCode: 'approved', approvedAmount: '100.00' };
function review(overrides: Omit<Partial<InvoiceReview>, 'lines'> & { status?: string; lines?: Partial<InvoiceReviewLine>[] } = {}) {
  const { status = 'under_review', lines = [{ invoiceLineId: 'l1', amount: '100.00', working: null, decision: null }], ...rest } = overrides;
  return {
    invoice: { invoiceId: 'i1', statusCode: status, caseId: 'c1', enteredInReview: false, professionalDisplayName: 'Sam Lee' },
    lines,
    questions: [],
    assignments: { reviewer: { userAccountId: 'u1', displayName: 'Reviewer' }, signOff: [] },
    signOffs: [],
    ruleFindings: [],
    mileageDismissals: [],
    fileSource: null,
    submitterChanges: null,
    entryOpen: false,
    timeLog: null,
    caseNumber: null,
    ...rest,
  } as unknown as InvoiceReview;
}
const canReview = { reviewLines: true, reassign: false, signOff: false } as never;

describe('reviewFacts', () => {
  it('lets a reviewer decide and enter only while in review', () => {
    expect(reviewFacts(review({ entryOpen: true }), 'u1', canReview)).toMatchObject({ inReview: true, canDecide: true, entering: true });
    expect(reviewFacts(review({ entryOpen: true }), 'u1', undefined)).toMatchObject({ canDecide: false, entering: false });
    expect(reviewFacts(review({ status: 'awaiting_sign_off' }), 'u1', canReview)).toMatchObject({ inReview: false, canDecide: false });
  });

  it("notes when deciding on someone else's invoice", () => {
    expect(reviewFacts(review(), 'u2', canReview).someoneElses).toBe(true);
    expect(reviewFacts(review(), 'u1', canReview).someoneElses).toBe(false);
  });

  it('is every line decided only when not waiting for an answer', () => {
    const lines = [{ invoiceLineId: 'l1', amount: '100.00', working: decided, decision: null }] as Partial<InvoiceReviewLine>[];
    expect(reviewFacts(review({ lines }), 'u1', canReview).everyLineDecided).toBe(true);
    expect(reviewFacts(review({ lines, status: 'awaiting_answer' }), 'u1', canReview).everyLineDecided).toBe(false);
  });

  it("summarizes the submitter's changes", () => {
    const facts = reviewFacts(review({ submitterChanges: { changedCount: 1, removedCount: 2, addedCount: 0 } as never }), 'u1', canReview);
    expect(facts.changedCount).toBe(3);
    expect(facts.changesSummary).toBe('1 line, removed 2');
  });
});
