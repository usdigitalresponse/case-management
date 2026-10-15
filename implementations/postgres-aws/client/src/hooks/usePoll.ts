import { useEffect, useState } from 'react';

// Re-fetches every `intervalMs` while `active`, keeping the last result
// between fetches (useApiResource clears it, which would flash a loading
// state). A new `key` (what is being polled) starts afresh. Failed fetches
// are skipped; the next one tries again.
export function usePoll<T>(fetchFn: () => Promise<T>, active: boolean, intervalMs: number, key: string = ''): T | null {
  const [data, setData] = useState<{ key: string; value: T } | null>(null);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    const timer = setInterval(() => {
      fetchFn()
        .then((value) => {
          if (!cancelled) setData({ key, value });
        })
        .catch(() => undefined);
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, intervalMs, key]);

  return data && data.key === key ? data.value : null;
}
