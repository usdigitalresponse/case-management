// @vitest-environment jsdom
import '../testing/routerInJsdom';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DISCARD_EDITS, useSaveBeforeLeaving } from './useSaveBeforeLeaving';

afterEach(cleanup);

// A page with edits in place, saved by `save`, which may also clear them.
function setup({ unsaved = true, save = async () => true }: { unsaved?: boolean; save?: () => Promise<boolean> } = {}) {
  const page = { unsaved, edit: () => {} };
  const saves = vi.fn(save);
  const onRefused = vi.fn();
  function Editor() {
    const [edits, setEdits] = useState(0);
    page.edit = () => {
      page.unsaved = true;
      setEdits((n) => n + 1);
    };
    useSaveBeforeLeaving({ unsaved: () => page.unsaved, save: saves, edits, onRefused });
    return <p>editing</p>;
  }
  const router = createMemoryRouter(
    [
      { path: '/edit', element: <Editor /> },
      { path: '/other', element: <p>other</p> },
    ],
    { initialEntries: ['/edit'] },
  );
  render(<RouterProvider router={router} />);
  const leave = async (to: string, state?: unknown) => {
    await act(async () => {
      await router.navigate(to, { state });
    });
  };
  const at = () => router.state.location.pathname + router.state.location.search;
  return { page, saves, onRefused, leave, at };
}

describe('useSaveBeforeLeaving', () => {
  it('leaves at once with nothing unsaved', async () => {
    const { saves, leave, at } = setup({ unsaved: false });
    await leave('/other');
    expect(at()).toBe('/other');
    expect(saves).not.toHaveBeenCalled();
  });

  it('saves before the next page opens', async () => {
    const pathsWhenSaving: string[] = [];
    const { leave, at } = setup({
      save: async () => {
        pathsWhenSaving.push(at());
        return true;
      },
    });
    await leave('/other');
    await waitFor(() => expect(at()).toBe('/other'));
    expect(pathsWhenSaving).toEqual(['/edit']);
  });

  it('stays when the save fails, and goes anyway on a second try', async () => {
    const { saves, onRefused, leave, at } = setup({ save: async () => false });
    await leave('/other');
    await waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
    expect(at()).toBe('/edit');
    await leave('/other');
    expect(at()).toBe('/other');
    expect(saves).toHaveBeenCalledTimes(1);
  });

  it('checks again after a new edit following a refusal', async () => {
    const { page, saves, onRefused, leave, at } = setup({ save: async () => false });
    await leave('/other');
    await waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
    act(() => page.edit());
    await leave('/other');
    await waitFor(() => expect(onRefused).toHaveBeenCalledTimes(2));
    expect(at()).toBe('/edit');
    expect(saves).toHaveBeenCalledTimes(2);
  });

  it('leaves when a failed save left nothing to keep, as when the lines changed elsewhere', async () => {
    const setupResult = setup({
      save: async () => {
        setupResult.page.unsaved = false;
        return false;
      },
    });
    await setupResult.leave('/other');
    await waitFor(() => expect(setupResult.at()).toBe('/other'));
    expect(setupResult.onRefused).not.toHaveBeenCalled();
  });

  it('leaves without saving after deleting what was edited', async () => {
    const { saves, leave, at } = setup();
    await leave('/other', DISCARD_EDITS);
    expect(at()).toBe('/other');
    expect(saves).not.toHaveBeenCalled();
  });

  it("doesn't save for a change to the page's own query string", async () => {
    const { saves, leave, at } = setup();
    await leave('/edit?filter=open');
    expect(at()).toBe('/edit?filter=open');
    expect(saves).not.toHaveBeenCalled();
  });
});
