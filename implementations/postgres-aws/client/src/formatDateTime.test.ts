import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, formatPeriod } from './formatDateTime';

describe('dates', () => {
  it('read day, short month, year', () => {
    expect(formatDate('2026-09-03')).toBe('3 Sep 2026');
    expect(formatPeriod('2026-08-01', '2026-08-31')).toBe('1 Aug 2026 – 31 Aug 2026');
  });

  it('keep the viewer’s local date for a timestamp, so an evening submission isn’t shown as the next day', () => {
    // 8:30 PM on 9 Nov in Los Angeles is already 10 Nov in UTC.
    expect(formatDay('2026-11-10T04:30:00.000Z', 'America/Los_Angeles')).toBe('9 Nov 2026');
  });

  it('never shift calendar dates', () => {
    expect(formatDate('2026-11-10')).toBe('10 Nov 2026');
  });
});
