// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import type { DuplicatePerson, MergePreview, PossibleDuplicate } from '../api/client';
import MergePeople from './MergePeople';
import PossibleDuplicates from './PossibleDuplicates';

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

const kept = person({ personId: 'person-a', email: 'jordan@example.test', invoiceCount: 3 });
const retired = person({ personId: 'person-b', invoiceCount: 1 });

const preview: MergePreview = {
  kept,
  retired,
  moves: [{ label: 'Invoices filed under them', count: 1 }],
  filledIn: [{ label: 'Date of birth', value: '1980-02-03' }],
  notMoved: [],
  blockers: [],
};

describe('merging two people', () => {
  it('shows what moves and merges only once an administrator confirms', async () => {
    const api = fakeApi({
      ...signedIn(ADMIN),
      'GET /api/people/merge-preview': preview,
      'POST /api/people/merges': { personMergeId: 'merge-1', changed: 3 },
    });
    const page = await renderPage(<MergePeople />, { path: '/possible-duplicates/merge', url: '/possible-duplicates/merge?keep=person-a&retire=person-b' });

    expect(await screen.findByRole('rowheader', { name: 'Invoices filed under them' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1980-02-03' })).toBeTruthy();
    const merge = screen.getByRole('button', { name: 'Merge into Jordan Example' }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(merge);
    await waitFor(() => expect(page.elsewhere()).toBe('/possible-duplicates'));
    expect(api.callsTo('POST', '/api/people/merges')[0]?.body).toMatchObject({ keptPersonId: 'person-a', retiredPersonId: 'person-b' });
    expect(api.unhandled).toEqual([]);
  });

  it('says why a pair can’t be merged, and offers no merge to other staff', async () => {
    fakeApi({ ...signedIn(REVIEWER), 'GET /api/people/merge-preview': { ...preview, blockers: ['Both are assigned to the same case.'] } });
    await renderPage(<MergePeople />, { path: '/possible-duplicates/merge', url: '/possible-duplicates/merge?keep=person-a&retire=person-b' });

    expect(await screen.findByText('Both are assigned to the same case.')).toBeTruthy();
    expect(screen.getByText(/Only an administrator can merge people/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Merge into/ })).toBeNull();
  });
});

describe('possible duplicates', () => {
  it('lets any staff member record that a pair are different people', async () => {
    const pair: PossibleDuplicate = { people: [kept, retired], reasons: ['same_name'], flagged: null };
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/people/possible-duplicates': { duplicates: [pair] },
      'GET /api/people/merges': { merges: [] },
      'POST /api/people/possible-duplicates': {},
    });
    await renderPage(<PossibleDuplicates />, { path: '/possible-duplicates', url: '/possible-duplicates' });

    expect(await screen.findByText('Same name')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what a merge would do' }).getAttribute('href')).toBe('/possible-duplicates/merge?keep=person-a&retire=person-b');
    fireEvent.click(screen.getByRole('button', { name: 'Not the same person' }));
    fireEvent.click(await screen.findByRole('button', { name: 'They are different people' }));

    await screen.findByText('Jordan Example and Jordan Example are recorded as different people.');
    expect(api.callsTo('POST', '/api/people/possible-duplicates')[0]?.body).toMatchObject({ personIds: ['person-a', 'person-b'], outcome: 'not_duplicate' });
    expect(api.unhandled).toEqual([]);
  });
});
