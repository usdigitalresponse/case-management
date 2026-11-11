import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from 'react-router';
import { queryClient } from './queryClient';
import { loadedJustNow, type Resource } from './hooks/useResource';
import { nextLoadIsFirst, preload } from './routeLoaders';

const args = { params: {}, request: new Request('http://localhost/page') } as unknown as LoaderFunctionArgs;

function counted(key: string, extra: Partial<Resource<number>> = {}) {
  const load = vi.fn(async () => 1);
  return { resource: { key: [key], load, ...extra }, load };
}

function revalidates(route: ReturnType<typeof preload>, from: string, to: string) {
  return route.shouldRevalidate({
    currentUrl: new URL(from, 'http://localhost'),
    nextUrl: new URL(to, 'http://localhost'),
    defaultShouldRevalidate: true,
  } as ShouldRevalidateFunctionArgs);
}

// Each test after the first page of its router.
beforeEach(() => void preload(() => []).loader(args));
afterEach(() => queryClient.clear());

describe('preload', () => {
  it('opens a cached list without waiting for it', async () => {
    const { resource, load } = counted('list');
    queryClient.setQueryData(resource.key, 0);
    await preload(() => [resource]).loader(args);
    expect(load).not.toHaveBeenCalled();
  });

  it('waits for a cached list marked out of date by a change', async () => {
    const { resource, load } = counted('stale-list');
    queryClient.setQueryData(resource.key, 0);
    await queryClient.invalidateQueries({ queryKey: resource.key, refetchType: 'none' });
    await preload(() => [resource]).loader(args);
    expect(load).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(resource.key)).toBe(1);
  });

  it('shows a new router\'s first page without waiting for its data', async () => {
    let finish = (_value: number) => {};
    const resource = { key: ['slow'], load: () => new Promise<number>((resolve) => (finish = resolve)), fresh: true };
    nextLoadIsFirst();
    await preload(() => [resource]).loader(args);
    expect(queryClient.getQueryState(resource.key)?.fetchStatus).toBe('fetching');
    expect(loadedJustNow(resource)).toBeUndefined();
    finish(1);
  });

  it('always loads a fresh resource afresh, even just after a load', async () => {
    const { resource, load } = counted('edited', { fresh: true });
    queryClient.setQueryData(resource.key, 0);
    await preload(() => [resource]).loader(args);
    expect(load).toHaveBeenCalledTimes(1);
    expect(loadedJustNow(resource)).toBe(1);
  });

  it('leaves a failed load for the page to show', async () => {
    const resource = { key: ['failing'], load: () => Promise.reject(new Error('no')), fresh: true };
    await expect(preload(() => [resource]).loader(args)).resolves.toBeNull();
    expect(loadedJustNow(resource)).toBeUndefined();
  });

  it('runs again for a new address or a named search param, not other filters', () => {
    const route = preload(() => [], { searchParams: ['view'] });
    expect(revalidates(route, '/a', '/b')).toBe(true);
    expect(revalidates(route, '/a', '/a?view=county')).toBe(true);
    expect(revalidates(route, '/a', '/a?status=open')).toBe(false);
  });
});

describe('loadedJustNow', () => {
  it('ignores data marked out of date by a change', async () => {
    const { resource } = counted('changed');
    queryClient.setQueryData(resource.key, 1);
    expect(loadedJustNow(resource)).toBe(1);
    await queryClient.invalidateQueries({ queryKey: resource.key, refetchType: 'none' });
    expect(loadedJustNow(resource)).toBeUndefined();
  });
});
