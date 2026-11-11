import { useCallback, useEffect, useRef, useState } from 'react';
import { queryClient } from '../queryClient';
import { loadedJustNow, resourceQuery, type Resource } from './useCachedResource';

// Uncached page load; given a resource, starts with what its route's loader just fetched.
export function useApiResource<T>(
  source: (() => Promise<T>) | Resource<T>,
  deps: unknown[],
): { data: T | null; error: unknown; reload: () => Promise<void> } {
  const preloaded = typeof source === 'function' ? undefined : source;
  const fetchFn = typeof source === 'function' ? source : source.load;
  const [data, setData] = useState<T | null>(() => (preloaded ? (loadedJustNow(preloaded) ?? null) : null));
  const [error, setError] = useState<unknown>(null);
  const latestFetch = useRef(fetchFn);
  latestFetch.current = fetchFn;
  const preloadedDeps = useRef<unknown[] | null>(data === null ? null : deps);

  useEffect(() => {
    const kept = preloadedDeps.current;
    if (kept && kept.length === deps.length && kept.every((value, index) => Object.is(value, deps[index]))) {
      return undefined;
    }
    preloadedDeps.current = null;
    setError(null);
    // A new address its loader has just loaded shows at once.
    const ready = preloaded ? loadedJustNow(preloaded) : undefined;
    if (ready !== undefined) {
      setData(ready);
      return undefined;
    }
    let cancelled = false;
    setData(null);
    // Through the cache, so a load the route's loader started isn't repeated.
    (preloaded ? queryClient.fetchQuery({ ...resourceQuery(preloaded), staleTime: 0 }) : fetchFn())
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Refetches while keeping the current data on screen.
  const reload = useCallback(() => latestFetch.current().then(setData, setError), []);

  return { data, error, reload };
}
