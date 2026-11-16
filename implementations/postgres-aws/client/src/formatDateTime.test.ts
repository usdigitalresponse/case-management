import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, formatPeriod } from './formatDateTime';

describe('dates', () => {
  it('read short month, day, year, the American way', () => {
    expect(formatDate('2026-09-03')).toBe('Sep 3, 2026');
  });

  it('give a period once, without repeating its month or year', () => {
    expect(formatPeriod('2026-08-01', '2026-08-31')).toBe('Aug 1 to 31, 2026');
    expect(formatPeriod('2026-01-30', '2026-02-02')).toBe('Jan 30 to Feb 2, 2026');
    expect(formatPeriod('2025-12-15', '2026-01-10')).toBe('Dec 15, 2025 to Jan 10, 2026');
    expect(formatPeriod('2026-08-01', null)).toBe('Aug 1, 2026 to —');
  });

  it('keep the viewer’s local date for a timestamp, so an evening submission isn’t shown as the next day', () => {
    // 8:30 PM on Nov 9 in Los Angeles is already Nov 10 in UTC.
    expect(formatDay('2026-11-10T04:30:00.000Z', 'America/Los_Angeles')).toBe('Nov 9, 2026');
  });

  it('never shift calendar dates', () => {
    expect(formatDate('2026-11-10')).toBe('Nov 10, 2026');
  });

  it('show an unreadable date as given instead of failing', () => {
    expect(formatDate('2026-13-45')).toBe('2026-13-45');
    expect(formatDay('not a time')).toBe('not a time');
  });
});
