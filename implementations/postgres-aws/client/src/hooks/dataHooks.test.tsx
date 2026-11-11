// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { resourceQuery, useResource, type Resource } from './useResource';

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

describe('useResource', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

  it('shows a list as it was while it refreshes', async () => {
    const list = resource('list', 'new');
    cached(list, 'old', 60_000);
    const { result } = renderHook(() => useResource(list), { wrapper });
    expect(result.current.data).toBe('old');
    await waitFor(() => expect(result.current.data).toBe('new'));
  });

  it("never shows a fresh resource's earlier copy", async () => {
    const page = resource('page', 'new', { fresh: true });
    cached(page, 'old', 60_000);
    const { result } = renderHook(() => useResource(page), { wrapper });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe('new'));
  });

  it("moves to the next address's preloaded data without blanking", () => {
    const first = resource('a', 'A', { fresh: true });
    const second = resource('b', 'B', { fresh: true });
    cached(first, 'A');
    const { result, rerender } = renderHook(({ item }) => useResource(item), { wrapper, initialProps: { item: first } });
    cached(second, 'B');
    rerender({ item: second });
    expect(result.current.data).toBe('B');
    expect(second.load).not.toHaveBeenCalled();
  });

  it('waits for a load the loader started instead of repeating it', async () => {
    let finish = (_value: string) => {};
    const page = { key: ['item', 'slow'], load: vi.fn(() => new Promise<string>((resolve) => (finish = resolve))), fresh: true };
    cached(page, 'old');
    void queryClient.fetchQuery({ ...resourceQuery(page), staleTime: 0 });
    const { result } = renderHook(() => useResource(page), { wrapper });
    expect(result.current.data).toBeNull();
    finish('new');
    await waitFor(() => expect(result.current.data).toBe('new'));
    expect(page.load).toHaveBeenCalledTimes(1);
  });

  it('clears a fresh resource and loads again when a save bumps its reset key', async () => {
    const page = resource('page', 'saved', { fresh: true });
    cached(page, 'loaded');
    const { result, rerender } = renderHook(({ version }) => useResource(page, { resetKey: version }), { wrapper, initialProps: { version: 0 } });
    expect(result.current.data).toBe('loaded');
    rerender({ version: 1 });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe('saved'));
    expect(page.load).toHaveBeenCalledTimes(1);
  });

  it('shows a fresh resource loaded for this visit at once', () => {
    const page = resource('page', 'new', { fresh: true });
    cached(page, 'loaded');
    const { result } = renderHook(() => useResource(page), { wrapper });
    expect(result.current.data).toBe('loaded');
    expect(page.load).not.toHaveBeenCalled();
  });
});
