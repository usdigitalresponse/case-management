// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import type { AuthenticatedUser, CaseFixPreview, PersonMerge, PossibleDuplicate, PossibleDuplicateCase } from '../api/client';
import { MergeDuplicates } from './MergeDuplicates';

afterEach(() => {
  cleanup();
  queryClient.clear();
});

const ADMIN = { ...REVIEWER, isAdmin: true };

const cases: PossibleDuplicateCase = {
  cases: [
    { caseId: 'case-1', caseNumber: '26-CR-0418', otherNumbers: [], clientDisplayName: 'Alex Client', countyDisplayName: 'North', openedOn: '2026-01-02', invoiceCount: 1 },
    { caseId: 'case-2', caseNumber: '26CR418', otherNumbers: [], clientDisplayName: 'Alex Client', countyDisplayName: 'North', openedOn: '2026-03-04', invoiceCount: 3 },
  ],
  pairs: [{ caseIds: ['case-1', 'case-2'], reasons: ['same_number', 'same_county'], flagged: null }],
};

const people: PossibleDuplicate = {
  people: [
    { personId: 'person-a', displayName: 'Jordan Example', email: 'jordan@example.test', dateOfBirth: null, provider: { professionalId: 'prof-a', kind: 'Investigator', signInEmail: null }, caseCount: 0, invoiceCount: 3 },
    { personId: 'person-b', displayName: 'Jordan Exampel', email: null, dateOfBirth: null, provider: null, caseCount: 0, invoiceCount: 0 },
  ],
  pairs: [{ personIds: ['person-a', 'person-b'], reasons: ['flagged'], flagged: { note: null, byDisplayName: 'A Reviewer', at: '2026-11-01T12:00:00Z' } }],
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

const preview: CaseFixPreview = {
  invoices: [{ invoiceId: 'inv-1', senderDisplayName: 'Sam', statusName: 'Signed off', submittedTotal: '10.00', caseNumberAsTyped: '26-CR-0418' }],
  preauthorizationRequests: [],
  preauthorizations: [],
  preauthorizationChoices: [],
  assignmentsMoved: 0,
  assignmentsEnded: 0,
  caseChanges: [],
  closes: true,
};

const routes = (user: AuthenticatedUser = ADMIN, merges: PersonMerge[] = []) => ({
  ...signedIn(user),
  'GET /api/cases/possible-duplicates': { duplicates: [cases] },
  'GET /api/people/possible-duplicates': { duplicates: [people] },
  'GET /api/people/merges': { merges },
});

const render = (url = '/settings') => renderPage(<MergeDuplicates />, { path: '/settings', url });

describe('Settings › Merge duplicates (design K67)', () => {
  it('lists cases and people together, with why they look alike and the invoices on each', async () => {
    const api = fakeApi(routes());
    await render();
    const caseRow = (await screen.findByRole('rowheader', { name: /26CR418 and 26-CR-0418/ })).closest('tr')!;
    expect(within(caseRow).getByText('Cases. Alex Client. North')).toBeTruthy();
    expect(within(caseRow).getByText('The same number without the punctuation')).toBeTruthy();
    expect(within(caseRow).getByText('3 and 1')).toBeTruthy();
    const personRow = screen.getByRole('rowheader', { name: /Jordan Example and Jordan Exampel/ }).closest('tr')!;
    expect(within(personRow).getByText('3 and none')).toBeTruthy();
    expect(within(personRow).getByRole('link', { name: 'Merge Jordan Example and Jordan Exampel' }).getAttribute('href')).toBe(
      '/people/merge?keep=person-a&retire=person-b',
    );
    expect(api.unhandled).toEqual([]);
  });

  it('merges two cases by moving the other’s invoices to the one kept, after showing what moves', async () => {
    const api = fakeApi({ ...routes(), 'POST /api/edit-data/cases/preview': preview, 'POST /api/edit-data/fixes': { caseCorrectionId: 'fix-1', changed: 4 } });
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'Merge 26CR418 and 26-CR-0418' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('radio', { name: /26CR418/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'See what moves' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Merge' }));

    expect(await screen.findByText(/1 invoice moved to 26CR418, and 26-CR-0418 closed\./)).toBeTruthy();
    expect(api.callsTo('POST', '/api/edit-data/fixes')[0]?.body).toEqual({ kind: 'same_case', caseId: 'case-1', keptCaseId: 'case-2', keepPreauthorizations: {} });
  });

  it('lets any staff member say a pair is not the same, but only administrators merge', async () => {
    const api = fakeApi({ ...routes(REVIEWER), 'POST /api/cases/possible-duplicates': {} });
    await render();
    await screen.findByRole('rowheader', { name: /26CR418 and 26-CR-0418/ });
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Merge/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Not the same : 26CR418 and 26-CR-0418' }));
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button')[0]!);
    await waitFor(() => expect(api.callsTo('POST', '/api/cases/possible-duplicates')[0]?.body).toMatchObject({ caseIds: ['case-2', 'case-1'], outcome: 'not_duplicate' }));
  });

  it('offers an administrator Undo after merging people', async () => {
    fakeApi(routes(ADMIN, [merge]));
    await render('/settings?merged=merge-1');
    expect(await screen.findByText('Merged 1 record into Jordan Example.')).toBeTruthy();
  });
});
