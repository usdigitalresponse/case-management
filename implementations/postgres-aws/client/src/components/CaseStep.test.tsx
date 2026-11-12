// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { queuedInvoice, REVIEWER, signedIn } from '../test/fixtures';
import type { CaseByNumber } from '../api/client';
import { CaseStep } from './CaseStep';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const found = (overrides: Partial<CaseByNumber> = {}): CaseByNumber => ({
  caseId: 'case-1',
  caseNumber: 'CR-24-0477',
  otherNumbers: [],
  clientDisplayName: 'M. Sample',
  countyId: 'county-a',
  countyDisplayName: 'County A',
  closed: false,
  match: 'exact',
  ...overrides,
});

const draft = (overrides = {}) =>
  queuedInvoice({ invoiceId: 'inv-1', caseId: null, caseNumberAsTyped: 'CR-24-0477', countyId: 'county-a', countyDisplayName: 'County A', ...overrides });

describe('the case step on a staff draft', () => {
  it('chooses the same number in the county without asking', async () => {
    const onChanged = vi.fn();
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/portal/invoices/:id/case-matches': { exact: found(), similar: [] },
      'PUT /api/portal/invoices/:id/case-choice': { invoiceId: 'inv-1', caseChoice: 'existing' },
    });
    await renderPage(<CaseStep invoice={draft()} mode="draft" onChanged={onChanged} />, { path: '/', url: '/' });

    expect(await screen.findByText('Case found')).toBeTruthy();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.calls.find((call) => call.method === 'PUT')!.body).toEqual({ choice: 'existing', caseId: 'case-1' });
  });

  it('makes staff say whether a close number is the same case, choosing nothing for them', async () => {
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/portal/invoices/:id/case-matches': { exact: null, similar: [found({ match: 'close' })] },
      'PUT /api/portal/invoices/:id/case-choice': { invoiceId: 'inv-1', caseChoice: 'new' },
    });
    await renderPage(<CaseStep invoice={draft({ caseNumberAsTyped: 'CR240477' })} mode="draft" onChanged={() => {}} />, { path: '/', url: '/' });

    const same = await screen.findByRole('radio', { name: /Similar M\. Sample · CR-24-0477 · County A/ });
    const added = screen.getByRole('radio', { name: /New Add case CR240477 in County A/ });
    expect((same as HTMLInputElement).checked).toBe(false);
    expect((added as HTMLInputElement).checked).toBe(false);
    expect(api.calls.some((call) => call.method === 'PUT')).toBe(false);

    fireEvent.click(added);
    await waitFor(() => expect(api.calls.find((call) => call.method === 'PUT')!.body).toEqual({ choice: 'new', confirmedNew: true }));
  });

  it('adds a new case when nothing matches, and records work not for one case', async () => {
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/portal/invoices/:id/case-matches': { exact: null, similar: [] },
      'PUT /api/portal/invoices/:id/case-choice': { invoiceId: 'inv-1', caseChoice: 'new' },
    });
    await renderPage(<CaseStep invoice={draft({ caseNumberAsTyped: 'CR-26-1312' })} mode="draft" onChanged={() => {}} />, { path: '/', url: '/' });

    expect(await screen.findByText(/No case CR-26-1312 in County A yet\. It’s added when you send\./)).toBeTruthy();
    await waitFor(() => expect(api.calls.find((call) => call.method === 'PUT')!.body).toEqual({ choice: 'new' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Not for one case' }));
    await waitFor(() => expect(api.calls.filter((call) => call.method === 'PUT').at(-1)!.body).toEqual({ choice: 'none' }));
    expect(screen.getByText(/For work like court observation/)).toBeTruthy();
  });
});

describe('the case step in review', () => {
  it('only suggests the same number, matching it with one step', async () => {
    const onChanged = vi.fn();
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/invoices/:id/case-matches': { exact: found(), similar: [] },
      'PUT /api/invoices/:id/case-choice': { caseId: 'case-1', addedCaseId: null, caseProblem: null },
    });
    await renderPage(<CaseStep invoice={draft({ statusCode: 'submitted' })} mode="review" onChanged={onChanged} />, { path: '/', url: '/' });

    expect(await screen.findByText('Suggested')).toBeTruthy();
    expect(api.calls.some((call) => call.method === 'PUT')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Use this case' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Matched to case CR-24-0477.'));
    expect(api.calls.find((call) => call.method === 'PUT')!.body).toEqual({ choice: 'existing', caseId: 'case-1' });
  });

  it('lets a reviewer type a number for an invoice that gives none, and add its case', async () => {
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/invoices/:id/case-matches': { exact: null, similar: [] },
      'PUT /api/invoices/:id/case-choice': { caseId: 'case-9', addedCaseId: 'case-9', caseProblem: null },
    });
    await renderPage(<CaseStep invoice={draft({ caseNumberAsTyped: null, statusCode: 'submitted' })} mode="review" onChanged={() => {}} />, {
      path: '/',
      url: '/',
    });

    fireEvent.change(await screen.findByLabelText('Case number'), { target: { value: 'CR-26-2000' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add case CR-26-2000 and match' }));
    await waitFor(() => expect(api.calls.find((call) => call.method === 'PUT')!.body).toEqual({ choice: 'new', confirmedNew: false, caseNumber: 'CR-26-2000' }));
  });
});
