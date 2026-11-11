import { afterEach, describe, expect, it, vi } from 'vitest';
import { today } from './today';

afterEach(() => {
  vi.useRealTimers();
});

describe('today', () => {
  it('is the local date, not UTC’s, late in the day', () => {
    vi.useFakeTimers();
    // 11:30 PM local time; UTC may already be tomorrow.
    vi.setSystemTime(new Date(2026, 10, 10, 23, 30));
    expect(today()).toBe('2026-11-10');
  });
});
