import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/auth/rateLimit';

describe('RateLimiter', () => {
  it('allows up to the limit in a window, then again once it resets', () => {
    const limiter = new RateLimiter();
    const limit = { max: 2, windowMs: 1000 };
    expect(limiter.take('a', limit, 0)).toBe(true);
    expect(limiter.take('a', limit, 10)).toBe(true);
    expect(limiter.take('a', limit, 20)).toBe(false);
    // Other keys are counted apart.
    expect(limiter.take('b', limit, 20)).toBe(true);
    expect(limiter.take('a', limit, 1000)).toBe(true);
  });
});
