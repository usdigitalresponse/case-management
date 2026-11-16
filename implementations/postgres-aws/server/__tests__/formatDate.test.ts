import { describe, expect, it } from 'vitest';
import { formatCalendarDate, formatInstant } from '../src/formatDate';

describe('dates in server messages', () => {
  it('write a calendar date as short month, day, year', () => {
    expect(formatCalendarDate('2026-09-04')).toBe('Sep 4, 2026');
    expect(formatCalendarDate('2026-13-45')).toBe('2026-13-45');
  });

  it('write an exact time with its zone', () => {
    expect(formatInstant(new Date('2026-11-11T05:14:29Z'))).toBe('Nov 11, 2026, 5:14 AM UTC');
  });

  it("write it in the sender's zone, so an evening send keeps its date", () => {
    expect(formatInstant(new Date('2026-11-11T05:14:29Z'), 'America/Los_Angeles')).toBe('Nov 10, 2026, 9:14 PM PST');
    // An unknown zone falls back to the reporting zone.
    expect(formatInstant(new Date('2026-11-11T05:14:29Z'), 'Not/AZone')).toBe('Nov 11, 2026, 5:14 AM UTC');
  });
});
