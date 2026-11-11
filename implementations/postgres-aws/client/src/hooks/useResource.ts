import { useCallback, useEffect, useMemo, useRef } from 'react';
import { hashKey, keepPreviousData, queryOptions, skipToken, useQuery } from '@tanstack/react-query';
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
  // Large, such as a file: dropped as soon as nothing shows it.
  discard?: boolean;
}

const NOTHING = ['nothing'] as const;
const updatesOf = (resource: Resource<unknown> | null) => (resource ? (queryClient.getQueryState(resource.key)?.dataUpdateCount ?? 0) : 0);

// Data a route's loader fetched for the page being opened, if still current.
export function loadedJustNow<T>(resource: Resource<T>): T | undefined {
  const state = queryClient.getQueryState<T>(resource.key);
  if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.dataUpdatedAt <= Date.now() - FRESH_MS) {
    return undefined;
  }
  return state.data;
}

export function resourceQuery<T>(resource: Resource<T>) {
  return queryOptions({
    queryKey: resource.key,
    queryFn: resource.load,
    meta: { fresh: resource.fresh === true, reference: resource.reference === true },
    ...(resource.discard && { gcTime: 0 }),
  });
}

// A new `resetKey` (bumped after a save) loads again, clearing a fresh resource first; null loads nothing.
export function useResource<T>(
  resource: Resource<T> | null,
  { resetKey }: { resetKey?: unknown } = {},
): { data: T | null; error: unknown; pending: boolean; reload: () => Promise<void> } {
  const keyHash = hashKey(resource?.key ?? NOTHING);
  const committedReset = useRef(resetKey);
  const reset = !Object.is(committedReset.current, resetKey);
  const opened = useMemo(
    () => ({
      updates: updatesOf(resource),
      loadedForThisVisit: !reset && resource !== null && loadedJustNow(resource) !== undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash, resetKey],
  );
  const query = useQuery({
    ...(resource ? resourceQuery(resource) : { queryKey: NOTHING, queryFn: skipToken }),
    placeholderData: resource?.keepPrevious ? keepPreviousData : undefined,
  });
  const { refetch } = query;
  useEffect(() => {
    if (Object.is(committedReset.current, resetKey)) return;
    committedReset.current = resetKey;
    if (resource) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, refetch]);
  // Read so a reload re-renders even when its data is unchanged, and so kept as the same object.
  void query.dataUpdatedAt;
  const shown = !resource?.fresh || opened.loadedForThisVisit || updatesOf(resource) > opened.updates;
  const reload = useCallback(async () => {
    await refetch({ cancelRefetch: false });
  }, [refetch]);
  // Read even while hidden: useQuery re-renders only for what a render reads.
  const data = query.data ?? null;
  // No data yet for this key, or still the previous key's.
  const pending = query.isPending || query.isPlaceholderData || !shown;
  return { data: shown ? data : null, error: query.error, pending, reload };
}
