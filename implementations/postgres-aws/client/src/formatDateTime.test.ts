import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatDate, formatDay } from './formatDateTime';

const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  process.env.TZ = zone;
});

const medium = (year: number, month: number, day: number) => new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' });

describe('dates shown from timestamps', () => {
  it('keep the viewer’s local date, so an evening submission isn’t shown as the next day', () => {
    // 8:30 PM on 9 Nov in Los Angeles is already 10 Nov in UTC.
    expect(formatDay('2026-11-10T04:30:00.000Z')).toBe(medium(2026, 11, 9));
  });

  it('differ from calendar dates, which are never shifted', () => {
    expect(formatDate('2026-11-10')).toBe(medium(2026, 11, 10));
  });
});
