import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { markDataChanged, queryClient } from './queryClient';
import { resourceQuery, type Resource } from './hooks/useResource';

afterEach(() => queryClient.clear());

// A resource shown on screen, as useResource observes it.
async function onScreen(resource: Resource<number>) {
  const stop = new QueryObserver(queryClient, resourceQuery(resource)).subscribe(() => {});
  await vi.waitFor(() => expect(queryClient.getQueryState(resource.key)?.status).toBe('success'));
  return stop;
}

describe('markDataChanged', () => {
  it('refreshes a list on screen and leaves one off screen to load when opened', async () => {
    const shown = { key: ['shown'], load: vi.fn(async () => 1) };
    const hidden = { key: ['hidden'], load: vi.fn(async () => 1) };
    const stop = await onScreen(shown);
    queryClient.setQueryData(hidden.key, 0);
    markDataChanged();
    await vi.waitFor(() => expect(shown.load).toHaveBeenCalledTimes(2));
    expect(hidden.load).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(hidden.key)?.isInvalidated).toBe(true);
    stop();
  });

  it('never reloads a page being edited or reference data under the user', async () => {
    const edited = { key: ['edited'], load: vi.fn(async () => 1), fresh: true };
    const reference = { key: ['reference'], load: vi.fn(async () => 1), reference: true };
    const stops = [await onScreen(edited), await onScreen(reference)];
    markDataChanged();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(edited.load).toHaveBeenCalledTimes(1);
    expect(reference.load).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(edited.key)?.isInvalidated).toBe(true);
    stops.forEach((stop) => stop());
  });
});
