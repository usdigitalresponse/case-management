import { useCallback, useMemo } from 'react';
import { hashKey, keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { FRESH_MS, queryClient } from '../queryClient';

export interface Resource<T> {
  key: readonly unknown[];
  load: () => Promise<T>;
  // Edited by its page: shown only if loaded for this visit.
  fresh?: boolean;
  // While a filter changes, keep showing the previous results.
  keepPrevious?: boolean;
  // Changes rarely: refreshed when next opened, not on every change.
  reference?: boolean;
}

// Data a route's loader fetched for the page being opened, if still current.
export function loadedJustNow<T>(resource: Resource<T>): T | undefined {
  const state = queryClient.getQueryState<T>(resource.key);
  if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.dataUpdatedAt <= Date.now() - FRESH_MS) {
    return undefined;
  }
  return state.data;
}

export function resourceQuery<T>(resource: Resource<T>) {
  return queryOptions({ queryKey: resource.key, queryFn: resource.load, meta: { fresh: resource.fresh === true, reference: resource.reference === true } });
}

// Cached: a page opened again shows what it had while it refreshes.
export function useCachedResource<T>(resource: Resource<T>): { data: T | null; error: unknown; reload: () => Promise<void> } {
  const keyHash = hashKey(resource.key);
  const opened = useMemo(
    () => ({ at: Date.now(), loadedForThisVisit: loadedJustNow(resource) !== undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash],
  );
  const query = useQuery({
    ...resourceQuery(resource),
    placeholderData: resource.keepPrevious ? keepPreviousData : undefined,
  });
  const shown = !resource.fresh || opened.loadedForThisVisit || query.dataUpdatedAt >= opened.at;
  const { refetch } = query;
  const reload = useCallback(async () => {
    await refetch({ cancelRefetch: false });
  }, [refetch]);
  return { data: shown ? (query.data ?? null) : null, error: query.error, reload };
}
