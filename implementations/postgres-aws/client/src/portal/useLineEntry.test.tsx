// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { useLayoutEffect, useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { lineEditorRoutes, portalInvoice } from '../test/fixtures';
import { useLineEntry } from './useLineEntry';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const loaded = portalInvoice().lines;
let reload: (lines: typeof loaded) => void = () => {};

function Lines() {
  const [serverLines, setServerLines] = useState(loaded);
  reload = setServerLines;
  const entry = useLineEntry({
    serverLines,
    fileSource: null,
    caseId: null,
    professionalId: 'p-sender',
    save: async () => ({}),
    setToast: () => {},
    ownFile: true,
  });
  // Typed after the reload shows but before its effects run, as on a slow machine.
  useLayoutEffect(() => {
    if (serverLines !== loaded) entry.editLine(0, { description: 'Client meeting and call' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverLines]);
  return <p>{entry.lines.map((line) => line.description).join('|')}</p>;
}

it('keeps an edit typed while the lines reload', async () => {
  fakeApi(lineEditorRoutes());
  const router = createMemoryRouter([{ path: '/', element: <Lines /> }]);
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await act(async () => reload([{ ...loaded[0]!, description: 'Client meeting (reloaded)' }]));
  expect(container.querySelector('p')?.textContent).toBe('Client meeting and call');
});
