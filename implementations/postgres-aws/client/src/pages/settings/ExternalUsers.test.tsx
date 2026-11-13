// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { queryClient } from '../../queryClient';
import { fakeApi } from '../../test/fakeApi';
import { renderPage } from '../../test/renderPage';
import { REVIEWER, signedIn } from '../../test/fixtures';
import type { AuthenticatedUser, ExternalUser } from '../../api/client';
import { ExternalUserSettings } from './ExternalUsers';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const ADMIN = { ...REVIEWER, isAdmin: true };

const externalUser = (overrides: Partial<ExternalUser>): ExternalUser => ({
  personId: 'person-a',
  displayName: 'Ana Example',
  email: 'ana@example.test',
  kind: 'Investigator',
  delegateFor: [],
  signInEnabled: true,
  hasSignedIn: true,
  signInChangedAt: null,
  ...overrides,
});

const ana = externalUser({});
const cora = externalUser({ personId: 'person-c', displayName: 'Cora Example', kind: null, delegateFor: [{ officeId: 'office-1', displayName: 'North Office' }], signInEnabled: false, signInChangedAt: '2026-11-01T12:00:00Z' });
const eli = externalUser({ personId: 'person-e', displayName: 'Eli Example', email: null, signInEnabled: false, hasSignedIn: false });

const settingsRoutes = (user: AuthenticatedUser = ADMIN) => ({
  ...signedIn(user),
  'GET /api/settings/external-users': { items: [ana, cora], next: null },
  'GET /api/settings/professional-kinds': { kinds: [{ professionalKindId: 'kind-1', displayName: 'Investigator', active: true, rates: [] }] },
  'GET /api/settings/external-users/offices': { offices: [{ officeId: 'office-1', displayName: 'North Office' }] },
});

const render = (isAdmin = true) => renderPage(<ExternalUserSettings isAdmin={isAdmin} />, { path: '/settings', url: '/settings' });

async function pick(text: string, option: RegExp) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('external users in Settings', () => {
  it('lists who can sign in and turns one off', async () => {
    const api = fakeApi({ ...settingsRoutes(), 'PUT /api/settings/external-users/:personId': { ...ana, signInEnabled: false } });
    await render();

    const row = (await screen.findByRole('rowheader', { name: /Ana Example/ })).closest('tr')!;
    expect(within(row).getByText('On')).toBeTruthy();
    const delegate = screen.getByRole('rowheader', { name: /Cora Example/ }).closest('tr')!;
    expect(within(delegate).getByText('Sends for North Office')).toBeTruthy();
    expect(within(delegate).getByText(/Turned off/)).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'Turn off sign-in for Ana Example' }));
    expect(await screen.findByText('Ana Example can no longer sign in, and is signed out.')).toBeTruthy();
    expect(api.callsTo('PUT', '/api/settings/external-users/person-a')[0]?.body).toEqual({ signInEnabled: false });
    expect(api.unhandled).toEqual([]);
  });

  it('asks for an email before turning on someone who has none', async () => {
    const api = fakeApi({
      ...settingsRoutes(),
      'GET /api/settings/external-users/candidates': { people: [eli] },
      'POST /api/settings/external-users': { ...eli, email: 'eli@example.test', signInEnabled: true },
    });
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'Add office billing staff' }));
    await pick('eli', /Eli Example — Investigator — no email yet/);

    const turnOn = screen.getByRole('button', { name: 'Add email and turn on sign-in' }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'eli@example.test' } });
    // Office billing staff send for an office, so an existing person needs one too.
    expect(turnOn.disabled).toBe(true);
    await screen.findByRole('option', { name: 'North Office' });
    fireEvent.change(screen.getByLabelText('Office'), { target: { value: 'office-1' } });
    fireEvent.click(turnOn);

    expect(await screen.findByText(/Eli Example can now sign in at .*\/submit with eli@example.test/)).toBeTruthy();
    expect(api.callsTo('POST', '/api/settings/external-users')[0]?.body).toEqual({ personId: 'person-e', email: 'eli@example.test', officeId: 'office-1' });
    expect(api.unhandled).toEqual([]);
  });

  it('adds a new office billing delegate', async () => {
    const api = fakeApi({
      ...settingsRoutes(),
      'GET /api/settings/external-users/candidates': { people: [] },
      'POST /api/settings/external-users': externalUser({ personId: 'person-n', displayName: 'Nia Example', email: 'nia@example.test', kind: null, delegateFor: [{ officeId: 'office-1', displayName: 'North Office' }], hasSignedIn: false }),
    });
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'Add office billing staff' }));
    await pick('nia', /Add someone new/);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nia Example' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nia@example.test' } });
    fireEvent.change(screen.getByLabelText('Office'), { target: { value: 'office-1' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add office billing staff' }).at(-1)!);

    await waitFor(() =>
      expect(api.callsTo('POST', '/api/settings/external-users')[0]?.body).toEqual({
        newDelegate: { displayName: 'Nia Example', email: 'nia@example.test', officeId: 'office-1' },
      }),
    );
    expect(await screen.findByText(/Nia Example can now sign in/)).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it('makes an existing provider an office billing delegate', async () => {
    const api = fakeApi({
      ...settingsRoutes(),
      'POST /api/settings/external-users/:personId/offices': { ...ana, delegateFor: [{ officeId: 'office-1', displayName: 'North Office' }] },
    });
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'Offices… for Ana Example' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('None yet.')).toBeTruthy();
    await within(dialog).findByRole('option', { name: 'North Office' });
    fireEvent.change(within(dialog).getByLabelText('Also send invoices for'), { target: { value: 'office-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add office' }));

    expect(await screen.findByText("Ana Example can now send invoices for North Office's providers.")).toBeTruthy();
    expect(api.callsTo('POST', '/api/settings/external-users/person-a/offices')[0]?.body).toEqual({ officeId: 'office-1' });
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop sending for North Office' })).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it('is read-only for staff who are not administrators', async () => {
    const api = fakeApi(settingsRoutes(REVIEWER));
    await render(false);
    expect(await screen.findByRole('rowheader', { name: /Ana Example/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add office billing staff' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Turn off/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Offices/ })).toBeNull();
    expect(api.unhandled).toEqual([]);
  });
});
