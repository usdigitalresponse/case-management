import { describe, expect, it } from 'vitest';
import { lineAdjustment } from './lineReview/lineRates';
import { type PanelMode } from './lineReview/DecisionPanel';

// 2 hours billed at $100.00 an hour.
const line = { quantity: '2', billedRate: '100', amount: '200.00', rateType: 'hourly' as const, rateSource: 'person' as const };
const expense = { quantity: null, billedRate: null, amount: '45.00', rateType: null, rateSource: null };
const noScope = { offered: false, matching: 1, canSetCase: false };

const atRate = (rate: string, mode: PanelMode = 'rate', scope = noScope) => lineAdjustment(line, mode, { hours: '', rate, amount: '' }, scope);

describe('approving a line at a different rate', () => {
  it('approves a higher rate with no reason, for more than was asked', () => {
    expect(atRate('125')).toMatchObject({ raised: true, rateValid: true, cutNeedsReason: false, approvedCents: 25000 });
  });

  it('treats a lower rate as a cut, which needs a reason', () => {
    expect(atRate('80')).toMatchObject({ raised: false, rateValid: true, validAmount: true, cutNeedsReason: true, approvedCents: 16000 });
  });

  it('can’t be sent at the billed rate, or at nothing', () => {
    expect(atRate('100')).toMatchObject({ rateValid: false, cutNeedsReason: false });
    expect(atRate('0')).toMatchObject({ rateValid: false });
  });

  it('keeps the billed hours, whatever hours the Part panel last had', () => {
    expect(lineAdjustment(line, 'rate', { hours: '1', rate: '80', amount: '' }, noScope).approvedCents).toBe(16000);
  });
});

describe('where a changed rate can go', () => {
  it('offers the matching lines or the case only on Rate', () => {
    const scope = { offered: true, matching: 3, canSetCase: true };
    expect(atRate('80', 'rate', scope).offerScope).toBe(true);
    expect(lineAdjustment(line, 'approved_in_part', { hours: '2', rate: '80', amount: '' }, scope).offerScope).toBe(false);
  });

  it('needs other lines or a case to offer', () => {
    expect(atRate('80', 'rate', { offered: true, matching: 1, canSetCase: false }).offerScope).toBe(false);
  });
});

describe('approving part of a line', () => {
  it('cuts by hours, with a reason', () => {
    expect(lineAdjustment(line, 'approved_in_part', { hours: '1.5', rate: '100', amount: '' }, noScope)).toMatchObject({
      validAmount: true,
      raised: false,
      cutNeedsReason: true,
      approvedCents: 15000,
    });
  });

  it('cuts an expense by its amount, only to less than was asked', () => {
    expect(lineAdjustment(expense, 'approved_in_part', { hours: '', rate: '', amount: '30' }, noScope)).toMatchObject({ validAmount: true });
    expect(lineAdjustment(expense, 'approved_in_part', { hours: '', rate: '', amount: '45' }, noScope)).toMatchObject({ validAmount: false });
  });
});
