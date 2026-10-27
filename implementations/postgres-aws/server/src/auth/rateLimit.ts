// Fixed-window counts in this process, for slowing down code requests and
// guesses. Fine for the single server instance; several instances would need
// a shared store.
export interface Limit {
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  // Counts one use of `key`; false once it is over the limit in this window.
  take(key: string, limit: Limit, now: number = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + limit.windowMs });
      this.prune(now);
      return true;
    }
    current.count += 1;
    return current.count <= limit.max;
  }

  private prune(now: number) {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

const HOUR = 60 * 60 * 1000;
export const SIGN_IN_LIMITS = {
  codesPerEmail: { max: 5, windowMs: HOUR },
  codesPerAddress: { max: 20, windowMs: HOUR },
  triesPerAddress: { max: 30, windowMs: 10 * 60 * 1000 },
} satisfies Record<string, Limit>;
