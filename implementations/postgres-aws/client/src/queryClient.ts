import { QueryClient } from '@tanstack/react-query';
import { DATA_CHANGED_EVENT } from './api/client';

// How long loaded data counts as current: a page opened again within it isn't refetched.
export const FRESH_MS = 5_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: FRESH_MS, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
});

// After a change: refresh lists on screen; mark the rest stale, to load again when next opened.
export function markDataChanged() {
  const keep = (query: { meta?: Record<string, unknown> }) => query.meta?.fresh === true || query.meta?.reference === true;
  void queryClient.invalidateQueries({ predicate: (query) => !keep(query) });
  void queryClient.invalidateQueries({ predicate: keep, refetchType: 'none' });
}

export function refreshCacheOnDataChange(): () => void {
  window.addEventListener(DATA_CHANGED_EVENT, markDataChanged);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, markDataChanged);
}
