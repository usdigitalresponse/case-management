// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import type { DuplicatePerson, MergePreview, RetiredPlan } from '../api/client';
import MergePeople from './MergePeople';

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
const retired = person({ personId: 'person-b', email: 'jordan.office@example.test', invoiceCount: 1 });
const third = person({ personId: 'person-c', email: 'j.example@example.test' });

const plan = (overrides: Partial<RetiredPlan>): RetiredPlan => ({ person: retired, moves: [], filledIn: [], notMoved: [], blockers: [], ...overrides });

const preview: MergePreview = {
  kept,
  retired: [plan({ moves: [{ label: 'Invoices filed under them', count: 1 }], filledIn: [{ label: 'Date of birth', value: '1980-02-03' }] })],
};

const MERGE_URL = '/people/merge';

describe('merging people', () => {
  it('shows what moves and merges only once an administrator confirms', async () => {
    const api = fakeApi({
      ...signedIn(ADMIN),
      'GET /api/people/merge-preview': preview,
      'POST /api/people/merges': { personMergeIds: ['merge-1'] },
    });
    const page = await renderPage(<MergePeople />, { path: MERGE_URL, url: `${MERGE_URL}?keep=person-a&retire=person-b` });

    expect(await screen.findByRole('heading', { name: 'Merge 2 records for Jordan Example' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Invoices filed under them' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1980-02-03' })).toBeTruthy();
    const merge = screen.getByRole('button', { name: 'Merge into Jordan Example (jordan@example.test)' }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(merge);
    await waitFor(() => expect(page.elsewhere()).toBe('/people'));
    expect(api.callsTo('POST', '/api/people/merges')[0]?.body).toMatchObject({ keptPersonId: 'person-a', retiredPersonIds: ['person-b'] });
    expect(api.unhandled).toEqual([]);
  });

  it('merges several records at once, with a column for each', async () => {
    const api = fakeApi({
      ...signedIn(ADMIN),
      'GET /api/people/merge-preview': (request: { query: URLSearchParams }) => ({
        kept,
        retired: request.query
          .get('retire')!
          .split(',')
          .map((id) => plan({ person: id === 'person-b' ? retired : third, moves: [{ label: 'Roles on cases', count: id === 'person-b' ? 2 : 1 }] })),
      }),
      'POST /api/people/merges': { personMergeIds: ['merge-1', 'merge-2'] },
    });
    await renderPage(<MergePeople />, { path: MERGE_URL, url: `${MERGE_URL}?keep=person-a&retire=person-b,person-c` });

    expect(await screen.findByRole('columnheader', { name: 'From Jordan Example (j.example@example.test)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Merge into/ }));
    await waitFor(() => expect(api.callsTo('POST', '/api/people/merges')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/people/merges')[0]?.body).toMatchObject({ retiredPersonIds: ['person-b', 'person-c'] });
  });

  it('says why records can’t be merged, and offers no merge to other staff', async () => {
    fakeApi({ ...signedIn(REVIEWER), 'GET /api/people/merge-preview': { kept, retired: [plan({ blockers: ['Both are assigned to the same case.'] })] } });
    await renderPage(<MergePeople />, { path: MERGE_URL, url: `${MERGE_URL}?keep=person-a&retire=person-b` });

    expect(await screen.findByText('Both are assigned to the same case.')).toBeTruthy();
    expect(screen.getByText(/Only an administrator can merge people/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Merge into/ })).toBeNull();
  });
});
