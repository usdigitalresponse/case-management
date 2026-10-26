import { describe, expect, it } from 'vitest';
import type { LineDecision } from './api/client';
import { reviewTotals, submittedByLabel } from './reviewTotals';

const decision = (outcomeCode: LineDecision['outcomeCode'], approvedAmount: string): LineDecision => ({
  outcomeCode,
  outcomeDisplayName: outcomeCode,
  approvedAmount,
  approvedQuantity: null,
  approvedRate: null,
  reasonCode: null,
  reasonDisplayName: null,
  note: null,
  decidedByDisplayName: null,
  decidedAt: '2026-01-10T00:00:00Z',
});

describe('review totals', () => {
  it('adds up decided lines only, in cents', () => {
    const lines = [
      { amount: '100.10', decision: decision('approved', '100.10') },
      { amount: '200.00', decision: decision('approved_in_part', '150.05') },
      { amount: '50.00', decision: decision('rejected', '0') },
      { amount: '75.00', decision: null },
    ];
    expect(reviewTotals(lines, (line) => line.decision)).toEqual({
      decided: 3,
      approved: 25015,
      cut: 9995,
      counts: { approved: 1, part: 1, rejected: 1 },
    });
  });
});

describe('who an invoice is from', () => {
  it('names a delegate who sent it for someone else', () => {
    expect(submittedByLabel({ professionalDisplayName: 'Expert', submittedByDisplayName: 'Expert' })).toBe('Expert');
    expect(submittedByLabel({ professionalDisplayName: 'Expert', submittedByDisplayName: 'Assistant' })).toBe('Expert, sent by Assistant');
    expect(submittedByLabel({ professionalDisplayName: null, submittedByDisplayName: null })).toBe('Unknown');
  });
});
