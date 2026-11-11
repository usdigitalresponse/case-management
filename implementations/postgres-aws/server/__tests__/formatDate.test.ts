import { describe, expect, it } from 'vitest';
import { formatCalendarDate, formatInstant } from '../src/formatDate';

describe('dates in server messages', () => {
  it('write a calendar date as day, short month, year', () => {
    expect(formatCalendarDate('2026-09-04')).toBe('4 Sep 2026');
  });

  it('write an exact time with its zone', () => {
    expect(formatInstant(new Date('2026-11-11T05:14:29Z'))).toBe('11 Nov 2026, 5:14 AM UTC');
  });
});
