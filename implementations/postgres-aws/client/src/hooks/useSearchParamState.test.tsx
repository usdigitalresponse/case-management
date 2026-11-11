// @vitest-environment jsdom
import '../testing/routerInJsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { useSearchParamState } from './useSearchParamState';

afterEach(cleanup);

function setup(start: string) {
  const page = { value: '', set: (_next: 'all' | 'open') => {} };
  function Filter() {
    [page.value, page.set] = useSearchParamState<'all' | 'open'>('show', 'all', ['all', 'open']);
    return null;
  }
  const router = createMemoryRouter([{ path: '/list', element: <Filter /> }], { initialEntries: ['/', start], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return { page, router, at: () => router.state.location.search };
}

describe('useSearchParamState', () => {
  it('reads the address, falling back for a missing or unknown value', () => {
    expect(setup('/list?show=open').page.value).toBe('open');
    cleanup();
    expect(setup('/list?show=bogus').page.value).toBe('all');
  });

  it('keeps other filters, leaves the default out and adds no history entry', async () => {
    const { page, router, at } = setup('/list?county=c1');
    await act(async () => page.set('open'));
    expect(at()).toBe('?county=c1&show=open');
    await act(async () => page.set('all'));
    expect(at()).toBe('?county=c1');
    await act(async () => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
  });
});
