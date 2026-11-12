import { useCallback, useEffect, useMemo, useRef } from 'react';
import { hashKey, infiniteQueryOptions, keepPreviousData, skipToken, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { Batch } from '../api/batches';
import { queryClient } from '../queryClient';
import { loadedJustNow } from './useResource';

// A list loaded a batch at a time as it scrolls (../components/MoreOnScroll.tsx).
export interface BatchedResource<T, Summary = never> {
  batched: true;
  key: readonly unknown[];
  load: (after: string | null) => Promise<Batch<T, Summary>>;
  // As a Resource's: edited by its page, shown only if loaded for this visit.
  fresh?: boolean;
  keepPrevious?: boolean;
}

const NOTHING = ['nothing'] as const;
const updatesOf = (resource: BatchedResource<unknown, unknown> | null) =>
  resource ? (queryClient.getQueryState(resource.key)?.dataUpdateCount ?? 0) : 0;

export function batchedQuery<T, Summary>(resource: BatchedResource<T, Summary>) {
  return infiniteQueryOptions({
    queryKey: resource.key,
    queryFn: ({ pageParam }: { pageParam: string | null }) => resource.load(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Batch<T, Summary>) => last.next,
    meta: { fresh: resource.fresh === true, reference: false },
  });
}

export interface BatchedList<T, Summary> {
  // Every batch so far, in order; null until the first.
  items: T[] | null;
  summary: Summary | null;
  error: unknown;
  pending: boolean;
  more: boolean;
  loadingMore: boolean;
  // The last next batch failed; the list so far stays.
  moreFailed: boolean;
  loadMore: () => void;
  // Loads again every batch shown, so the list keeps its place.
  reload: () => Promise<void>;
}

// As useResource: a new `resetKey` loads again, clearing a fresh list first; null loads nothing.
export function useBatchedResource<T, Summary = never>(
  resource: BatchedResource<T, Summary> | null,
  { resetKey }: { resetKey?: unknown } = {},
): BatchedList<T, Summary> {
  const keyHash = hashKey(resource?.key ?? NOTHING);
  const committedReset = useRef(resetKey);
  const reset = !Object.is(committedReset.current, resetKey);
  const opened = useMemo(
    () => ({
      updates: updatesOf(resource as BatchedResource<unknown, unknown> | null),
      loadedForThisVisit: !reset && resource !== null && loadedJustNow({ key: resource.key, load: () => Promise.resolve(null) }) !== undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyHash, resetKey],
  );
  const query = useInfiniteQuery({
    ...(resource
      ? batchedQuery(resource)
      : { queryKey: NOTHING, queryFn: skipToken, initialPageParam: null as string | null, getNextPageParam: () => null }),
    placeholderData: resource?.keepPrevious ? (keepPreviousData as (data: InfiniteData<Batch<T, Summary>, string | null> | undefined) => InfiniteData<Batch<T, Summary>, string | null> | undefined) : undefined,
  });
  const { refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  useEffect(() => {
    if (Object.is(committedReset.current, resetKey)) return;
    committedReset.current = resetKey;
    if (resource) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, refetch]);
  void query.dataUpdatedAt;
  const shown = !resource?.fresh || opened.loadedForThisVisit || updatesOf(resource as BatchedResource<unknown, unknown>) > opened.updates;
  const pages = query.data?.pages;
  const items = useMemo(() => (pages ? pages.flatMap((page) => page.items) : null), [pages]);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  const reload = useCallback(async () => {
    await refetch({ cancelRefetch: false });
  }, [refetch]);
  const pending = query.isPending || query.isPlaceholderData || !shown;
  return {
    items: shown ? items : null,
    summary: shown ? (pages?.[0]?.summary ?? null) : null,
    // A failed next batch is MoreOnScroll's to show; the list stays.
    error: query.isFetchNextPageError ? null : query.error,
    pending,
    more: Boolean(hasNextPage),
    loadingMore: isFetchingNextPage,
    moreFailed: query.isFetchNextPageError,
    loadMore,
    reload,
  };
}
