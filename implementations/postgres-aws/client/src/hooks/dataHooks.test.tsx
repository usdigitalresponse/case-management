// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { useApiResource } from './useApiResource';
import { resourceQuery, useCachedResource, type Resource } from './useCachedResource';

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function resource(id: string, value: string, extra: Partial<Resource<string>> = {}) {
  return { key: ['item', id], load: vi.fn(async () => value), ...extra };
}

// As the route's loader leaves it: loaded just now, or on an earlier visit.
function cached(item: Resource<string>, value: string, ageMs = 0) {
  queryClient.setQueryData(item.key, value, { updatedAt: Date.now() - ageMs });
}

describe('useApiResource given a resource', () => {
  it('starts with what the loader just fetched, without loading again', () => {
    const item = resource('a', 'new');
    cached(item, 'loaded');
    const { result } = renderHook(() => useApiResource(item, ['a']));
    expect(result.current.data).toBe('loaded');
    expect(item.load).not.toHaveBeenCalled();
  });

  it("loads afresh rather than show an earlier visit's copy", async () => {
    const item = resource('a', 'new');
    cached(item, 'old', 60_000);
    const { result } = renderHook(() => useApiResource(item, ['a']));
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe('new'));
  });

  it("moves to the next address's preloaded data without blanking", () => {
    const first = resource('a', 'A');
    const second = resource('b', 'B');
    cached(first, 'A');
    const { result, rerender } = renderHook(({ item, id }) => useApiResource(item, [id]), { initialProps: { item: first, id: 'a' } });
    cached(second, 'B');
    rerender({ item: second, id: 'b' });
    expect(result.current.data).toBe('B');
    expect(second.load).not.toHaveBeenCalled();
  });

  it('waits for a load the loader started instead of repeating it', async () => {
    let finish = (_value: string) => {};
    const item = { key: ['item', 'slow'], load: vi.fn(() => new Promise<string>((resolve) => (finish = resolve))) };
    cached(item, 'old');
    void queryClient.fetchQuery({ ...resourceQuery(item), staleTime: 0 });
    const { result } = renderHook(() => useApiResource(item, ['slow']));
    expect(result.current.data).toBeNull();
    finish('new');
    await waitFor(() => expect(result.current.data).toBe('new'));
    expect(item.load).toHaveBeenCalledTimes(1);
  });

  it('loads again after a save bumps its deps', async () => {
    const item = resource('a', 'saved');
    cached(item, 'loaded');
    const { result, rerender } = renderHook(({ version }) => useApiResource(item, ['a', version]), { initialProps: { version: 0 } });
    await queryClient.invalidateQueries({ queryKey: item.key, refetchType: 'none' });
    rerender({ version: 1 });
    await waitFor(() => expect(result.current.data).toBe('saved'));
    expect(item.load).toHaveBeenCalledTimes(1);
  });
});

describe('useCachedResource', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

  it('shows a list as it was while it refreshes', async () => {
    const list = resource('list', 'new');
    cached(list, 'old', 60_000);
    const { result } = renderHook(() => useCachedResource(list), { wrapper });
    expect(result.current.data).toBe('old');
    await waitFor(() => expect(result.current.data).toBe('new'));
  });

  it("never shows a fresh resource's earlier copy", async () => {
    const page = resource('page', 'new', { fresh: true });
    cached(page, 'old', 60_000);
    const { result } = renderHook(() => useCachedResource(page), { wrapper });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe('new'));
  });

  it('shows a fresh resource loaded for this visit at once', () => {
    const page = resource('page', 'new', { fresh: true });
    cached(page, 'loaded');
    const { result } = renderHook(() => useCachedResource(page), { wrapper });
    expect(result.current.data).toBe('loaded');
    expect(page.load).not.toHaveBeenCalled();
  });
});
