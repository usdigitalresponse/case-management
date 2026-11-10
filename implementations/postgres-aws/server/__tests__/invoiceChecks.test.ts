// Checks with no database: the pre-authorized limit and an invoice's details.
import { describe, expect, it } from 'vitest';
import { overPreauthorization, type PreauthorizationSummary } from '../src/billing/preauthorizations';
import { parseDetails } from '../src/billing/uploadDetails';
import { ValidationError } from '../src/errors';

const summary = (ceiling: string, approvedSoFar: string): PreauthorizationSummary => ({
  professionalId: null,
  authorizationNumbers: [],
  ceiling,
  approvedSoFar,
  waiting: '0.00',
});

describe('an invoice over the pre-authorized amount', () => {
  it('is flagged when what is approved so far plus its request goes over', () => {
    expect(overPreauthorization(summary('1000.00', '900.00'), '100.01', false)).toBe(true);
    expect(overPreauthorization(summary('1000.00', '900.00'), '100.00', false)).toBe(false);
  });

  it('counts a signed-off invoice once, as part of what is approved so far', () => {
    expect(overPreauthorization(summary('1000.00', '1000.00'), '400.00', true)).toBe(false);
    expect(overPreauthorization(summary('1000.00', '1000.01'), '400.00', true)).toBe(true);
  });

  it('is never flagged with nothing pre-authorized', () => {
    expect(overPreauthorization(null, '5000.00', false)).toBe(false);
  });
});

describe('an invoice’s billing period', () => {
  const details = { invoiceNumber: null };

  it('takes both days or neither, in order', () => {
    expect(parseDetails({ ...details, periodStart: null, periodEnd: null })).toMatchObject({ periodStart: null, periodEnd: null });
    expect(parseDetails({ ...details, periodStart: '2026-01-01', periodEnd: '2026-01-01' })).toMatchObject({ periodEnd: '2026-01-01' });
  });

  it('refuses half a period, or one that ends before it starts', () => {
    expect(() => parseDetails({ ...details, periodStart: '2026-01-01', periodEnd: null })).toThrow(ValidationError);
    expect(() => parseDetails({ ...details, periodStart: '2026-01-31', periodEnd: '2026-01-01' })).toThrow(
      expect.objectContaining({ fieldErrors: { periodEnd: 'The billing period must end on or after its first day.' } }),
    );
  });
});
