// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import type { PossibleDuplicateCase } from '../api/client';
import CaseList from './CaseList';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const caseGroup: PossibleDuplicateCase = {
  cases: [
    { caseId: 'case-1', caseNumber: '26-CR-0418', otherNumbers: [], clientDisplayName: 'Alex Client', countyDisplayName: 'North', openedOn: '2026-01-02', invoiceCount: 2 },
    { caseId: 'case-2', caseNumber: '26CR418', otherNumbers: [], clientDisplayName: 'Alex Client', countyDisplayName: 'North', openedOn: '2026-03-04', invoiceCount: 0 },
  ],
  pairs: [{ caseIds: ['case-1', 'case-2'], reasons: ['same_number'], flagged: null }],
};

const routes = (duplicates: PossibleDuplicateCase[]) => ({
  'GET /api/cases': { items: [], next: null, summary: { counts: { all: 2, open: 2, closed: 0 }, counties: [] } },
  'GET /api/portal/counties': { counties: [] },
  'GET /api/cases/possible-duplicates': { duplicates },
  'GET /api/cases/possible-duplicates/count': { groups: duplicates.length },
  'POST /api/cases/possible-duplicates': {},
});

describe('All cases’ Review duplicates tab', () => {
  it('is left out while there is nothing to review', async () => {
    const api = fakeApi({ ...signedIn(REVIEWER), ...routes([]) });
    await renderPage(<CaseList />, { path: '/cases', url: '/cases' });

    await screen.findByText('No cases match.');
    expect(screen.queryByRole('tab', { name: /^Review duplicates/ })).toBeNull();
    expect(api.unhandled).toEqual([]);
  });

  it('lists possible duplicate cases without offering to merge them', async () => {
    const api = fakeApi({ ...signedIn(REVIEWER), ...routes([caseGroup]) });
    await renderPage(<CaseList />, { path: '/cases', url: '/cases' });

    const tab = await screen.findByRole('tab', { name: 'Review duplicates, 1' });
    expect(api.callsTo('GET', '/api/cases/possible-duplicates')).toEqual([]);
    fireEvent.click(tab);
    expect(await screen.findByRole('link', { name: '26CR418' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /merge/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Not the same case' }));
    fireEvent.click(await screen.findByRole('button', { name: 'They are different cases' }));
    await screen.findByText(/are recorded as different cases/);
    expect(api.callsTo('POST', '/api/cases/possible-duplicates')[0]?.body).toMatchObject({ caseIds: ['case-1', 'case-2'], outcome: 'not_duplicate' });
    expect(api.unhandled).toEqual([]);
  });

  it('opens the flag dialog from the header', async () => {
    fakeApi({ ...signedIn(REVIEWER), ...routes([]) });
    await renderPage(<CaseList />, { path: '/cases', url: '/cases' });

    fireEvent.click(await screen.findByRole('button', { name: 'Flag possible duplicates' }));
    expect(await screen.findByRole('heading', { name: 'Flag two cases as possibly the same' })).toBeTruthy();
  });
});
