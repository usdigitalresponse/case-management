// @vitest-environment jsdom
import '../testing/routerInJsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { useSearchParamState, useSearchParamText } from './useSearchParamState';

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

describe('useSearchParamText', () => {
  function setupText(start: string) {
    const box = { text: '', type: (_next: string) => {} };
    function Search() {
      [box.text, box.type] = useSearchParamText('q');
      return null;
    }
    const router = createMemoryRouter([{ path: '/list', element: <Search /> }], { initialEntries: [start] });
    render(<RouterProvider router={router} />);
    return { box, router, q: () => new URLSearchParams(router.state.location.search).get('q') };
  }

  it('shows typing at once and writes the address after a pause', async () => {
    const { box, q } = setupText('/list');
    act(() => box.type('smi'));
    expect(box.text).toBe('smi');
    expect(q()).toBeNull();
    await waitFor(() => expect(q()).toBe('smi'));
  });

  it('follows the address when it changes elsewhere', async () => {
    const { box, router } = setupText('/list?q=lee');
    expect(box.text).toBe('lee');
    await act(async () => router.navigate('/list'));
    expect(box.text).toBe('');
  });
});
