import { describe, expect, it } from 'vitest';
import type { BillingRule } from '../api/client';
import { ruleSummary } from './BillingRules';

const rule = (code: BillingRule['code'], parameters: BillingRule['parameters'], enforcement: BillingRule['enforcement'] = 'warn') => ({
  code,
  label: code,
  description: '',
  warnOnly: false,
  enforcement,
  parameters,
});

describe('billing rules as firms see them', () => {
  it('says each rule in plain words, marking the required ones', () => {
    expect(ruleSummary(rule('time_increment', { increment: 0.1 }, 'require'))).toBe('time in steps of 0.1 h (required)');
    expect(ruleSummary(rule('daily_hour_cap', { hours: 10 }))).toBe('at most 10 h per person per day');
    expect(ruleSummary(rule('billing_period', { withinMonth: true }))).toBe('a billing period within one calendar month');
    expect(ruleSummary(rule('billing_codes', {}, 'require'))).toBe("a task code from the agency's list on each time item (required)");
  });
});
