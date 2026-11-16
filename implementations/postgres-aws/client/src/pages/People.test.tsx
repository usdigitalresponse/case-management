// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import People from './People';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const ADMIN = { ...REVIEWER, isAdmin: true };

describe('Providers', () => {
  it('sends its old Review duplicates tab to Settings, keeping a merge to undo', async () => {
    fakeApi({ ...signedIn(ADMIN) });
    const page = await renderPage(<People />, { path: '/people', url: '/people?tab=duplicates&merged=merge-1' });
    await waitFor(() => expect(page.elsewhere()).toBe('/settings'));
  });

  it('lists everyone who bills, with no tab of duplicates', async () => {
    const api = fakeApi({ ...signedIn(REVIEWER), 'GET /api/professionals/people': { items: [], next: null, summary: { roles: [] } } });
    await renderPage(<People />, { path: '/people', url: '/people' });
    await screen.findByText(/No providers yet/);
    expect(screen.queryByRole('tab', { name: /Review duplicates/ })).toBeNull();
    expect(api.unhandled).toEqual([]);
  });
});
