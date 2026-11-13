// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../../queryClient';
import { fakeApi } from '../../test/fakeApi';
import { renderPage } from '../../test/renderPage';
import { REVIEWER, signedIn } from '../../test/fixtures';
import type { AddedCase, CaseFixPreview } from '../../api/client';
import { EditData } from './EditData';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const ADMIN = { ...REVIEWER, isAdmin: true };

const added: AddedCase = {
  caseId: 'case-extra',
  caseNumber: 'CR240477',
  countyId: 'county-a',
  countyDisplayName: 'County A',
  clientDisplayName: null,
  addedAt: '2026-11-03T15:00:00Z',
  addedByDisplayName: 'Sam Staff',
  addedFrom: 'invoice',
  invoices: 1,
  preauthorizationRequests: 0,
  similar: [{ caseId: 'case-kept', caseNumber: 'CR-24-0477', clientDisplayName: 'M. Sample' }],
  elsewhere: [],
};

const preview: CaseFixPreview = {
  invoices: [{ invoiceId: 'inv-1', senderDisplayName: 'Riley Provider', statusName: 'In review', submittedTotal: '1480.00', caseNumberAsTyped: 'CR240477' }],
  preauthorizationRequests: [],
  preauthorizations: [],
  preauthorizationChoices: [],
  assignmentsMoved: 1,
  assignmentsEnded: 0,
  caseChanges: [],
  closes: true,
};

describe('Edit data', () => {
  it('shows exactly what moves before moving a case’s invoices to the same case', async () => {
    const api = fakeApi({
      ...signedIn(ADMIN),
      'GET /api/edit-data/cases': { cases: [added] },
      'GET /api/edit-data/fixes': { fixes: [] },
      'POST /api/edit-data/cases/preview': preview,
      'POST /api/edit-data/fixes': { caseCorrectionId: 'fix-1', changed: 5 },
    });
    await renderPage(<EditData />, { path: '/settings', url: '/settings?tab=edit-data' });

    expect(await screen.findByText('Sam Staff', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }));
    fireEvent.click(screen.getByRole('radio', { name: /It’s the same case as another/ }));
    expect((screen.getByRole('radio', { name: 'CR-24-0477 · M. Sample' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'See what changes' }));

    expect(await screen.findByText(/Invoice from Riley Provider, \$1,480\.00 requested, in review, sent as CR240477/)).toBeTruthy();
    expect(screen.getByText(/closed as added by mistake/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move and close' }));
    await waitFor(() => expect(api.calls.some((call) => call.method === 'POST' && call.path === '/api/edit-data/fixes')).toBe(true));
    expect(api.calls.find((call) => call.path === '/api/edit-data/fixes' && call.method === 'POST')!.body).toEqual({
      kind: 'same_case',
      caseId: 'case-extra',
      keptCaseId: 'case-kept',
      keepPreauthorizations: {},
    });
  });
});
