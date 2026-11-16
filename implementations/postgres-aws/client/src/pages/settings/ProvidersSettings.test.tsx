// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { queryClient } from '../../queryClient';
import { fakeApi } from '../../test/fakeApi';
import { renderPage } from '../../test/renderPage';
import { REVIEWER, signedIn } from '../../test/fixtures';
import type { AuthenticatedUser, VendorRecord } from '../../api/client';
import { ProvidersSettings } from './ProvidersSettings';

afterEach(() => {
  cleanup();
  queryClient.clear();
});

const ADMIN = { ...REVIEWER, isAdmin: true };

const ana: VendorRecord = {
  professionalId: 'prof-a',
  personId: 'person-a',
  displayName: 'Ana Example',
  active: true,
  externalSignInEnabled: false,
  email: 'ana@example.test',
  signedIn: false,
  professionalKindId: null,
  professionalKindDisplayName: 'Investigator',
  rates: [],
  officeDisplayName: null,
  sentByDisplayNames: [],
  sendsForCount: 0,
};

const routes = (user: AuthenticatedUser = ADMIN) => ({
  ...signedIn(user),
  'GET /api/professionals': { items: [ana], next: null },
  'GET /api/settings/professional-kinds': { kinds: [] },
});

const render = (isAdmin = true) => renderPage(<ProvidersSettings isAdmin={isAdmin} />, { path: '/settings', url: '/settings' });

describe('Settings › Providers (design K51)', () => {
  it('turns a provider’s sign-in on from the Active column', async () => {
    const api = fakeApi({ ...routes(), 'PUT /api/settings/external-users/:personId': {} });
    await render();
    const row = (await screen.findByRole('rowheader', { name: /Ana Example/ })).closest('tr')!;
    expect(within(row).getByText('No')).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Turn on sign-in for Ana Example' }));

    expect(await screen.findByText(/Ana Example can now sign in with ana@example.test/)).toBeTruthy();
    expect(api.callsTo('PUT', '/api/settings/external-users/person-a')[0]?.body).toEqual({ signInEnabled: true });
  });

  it('is read-only for staff who are not administrators', async () => {
    const api = fakeApi(routes(REVIEWER));
    await render(false);
    expect(await screen.findByRole('rowheader', { name: /Ana Example/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add provider' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Turn on/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(api.unhandled).toEqual([]);
  });
});
