// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import type { DuplicatePerson, PersonMerge, PossibleDuplicate } from '../api/client';
import People from './People';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const ADMIN = { ...REVIEWER, isAdmin: true };

const person = (overrides: Partial<DuplicatePerson>): DuplicatePerson => ({
  personId: 'person-a',
  displayName: 'Jordan Example',
  email: null,
  dateOfBirth: null,
  provider: null,
  caseCount: 0,
  invoiceCount: 0,
  ...overrides,
});

const group: PossibleDuplicate = {
  people: [
    person({ personId: 'person-b', email: 'jordan.office@example.test', invoiceCount: 1 }),
    person({ personId: 'person-a', email: 'jordan@example.test', invoiceCount: 3 }),
    person({ personId: 'person-c', email: 'j.example@example.test' }),
  ],
  pairs: [
    { personIds: ['person-a', 'person-b'], reasons: ['same_name'], flagged: null },
    { personIds: ['person-a', 'person-c'], reasons: ['same_name'], flagged: null },
  ],
};

const merge: PersonMerge = {
  personMergeId: 'merge-1',
  kept: { personId: 'person-a', displayName: 'Jordan Example' },
  retired: { personId: 'person-d', displayName: 'Jordan Example' },
  note: null,
  mergedAt: '2026-11-01T12:00:00Z',
  mergedBy: 'An Administrator',
  undoneAt: null,
};

const routes = (duplicates: PossibleDuplicate[], merges: PersonMerge[] = []) => ({
  'GET /api/professionals/people': { items: [], next: null, summary: { roles: [] } },
  'GET /api/people/possible-duplicates': { duplicates },
  'GET /api/people/possible-duplicates/count': { groups: duplicates.length },
  'GET /api/people/merges': { merges },
  'POST /api/people/possible-duplicates': {},
});

const reviewTab = () => screen.queryByRole('tab', { name: /^Review duplicates/ });

describe('People’s Review duplicates tab', () => {
  it('is left out while there is nothing to review', async () => {
    const api = fakeApi({ ...signedIn(REVIEWER), ...routes([]) });
    await renderPage(<People />, { path: '/people', url: '/people' });

    await screen.findByText(/No one yet/);
    expect(reviewTab()).toBeNull();
    expect(api.unhandled).toEqual([]);
  });

  it('shows one card for a person recorded three times, and lets any staff member separate a pair', async () => {
    const api = fakeApi({ ...signedIn(REVIEWER), ...routes([group]) });
    await renderPage(<People />, { path: '/people', url: '/people' });

    const tab = await screen.findByRole('tab', { name: 'Review duplicates, 1' });
    expect(api.callsTo('GET', '/api/people/possible-duplicates')).toEqual([]);
    fireEvent.click(tab);
    const review = await screen.findByRole('link', { name: 'See what a merge would do' });
    expect(review.getAttribute('href')).toBe('/people/merge?keep=person-a&retire=person-b%2Cperson-c');
    fireEvent.click(screen.getAllByRole('button', { name: 'Not the same person' })[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'They are different people' }));

    await screen.findByText(/are recorded as different people/);
    expect(api.callsTo('POST', '/api/people/possible-duplicates')[0]?.body).toMatchObject({ personIds: ['person-a', 'person-c'], outcome: 'not_duplicate' });
    expect(api.unhandled).toEqual([]);
  });

  it('offers an administrator Undo after a merge, on the tab the merge returns to', async () => {
    fakeApi({ ...signedIn(ADMIN), ...routes([], [merge]) });
    await renderPage(<People />, { path: '/people', url: '/people?tab=duplicates&merged=merge-1' });

    expect(await screen.findByText(/^Merged 1 record into Jordan Example/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Undo' }).length).toBeGreaterThan(0);
  });

  it('leaves the tab out for an administrator once nothing is left to review', async () => {
    const api = fakeApi({ ...signedIn(ADMIN), ...routes([], [merge]) });
    await renderPage(<People />, { path: '/people', url: '/people' });

    await screen.findByText(/No one yet/);
    expect(reviewTab()).toBeNull();
    expect(api.callsTo('GET', '/api/people/merges')).toEqual([]);
  });

  it('opens the flag dialog from the header, even with nothing listed', async () => {
    fakeApi({ ...signedIn(REVIEWER), ...routes([]) });
    await renderPage(<People />, { path: '/people', url: '/people' });

    fireEvent.click(await screen.findByRole('button', { name: 'Flag possible duplicates' }));
    expect(await screen.findByRole('heading', { name: 'Flag two people as possibly the same' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Review duplicates/, selected: true })).toBeTruthy();
  });
});
