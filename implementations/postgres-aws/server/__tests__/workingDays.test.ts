import { describe, expect, it } from 'vitest';
import { workingDaysBetween } from '../src/billing/workingDays';

describe('workingDaysBetween', () => {
  it('skips weekends', () => {
    // Friday 2026-10-23 to Monday 2026-10-26.
    expect(workingDaysBetween(new Date('2026-10-23T15:00:00Z'), new Date('2026-10-26T09:00:00Z'))).toBe(1);
    // Two full weeks.
    expect(workingDaysBetween(new Date('2026-10-12T12:00:00Z'), new Date('2026-10-26T12:00:00Z'))).toBe(10);
  });

  it('counts nothing on the same day or over a weekend alone', () => {
    expect(workingDaysBetween(new Date('2026-10-26T08:00:00Z'), new Date('2026-10-26T17:00:00Z'))).toBe(0);
    expect(workingDaysBetween(new Date('2026-10-24T08:00:00Z'), new Date('2026-10-25T17:00:00Z'))).toBe(0);
  });
});
