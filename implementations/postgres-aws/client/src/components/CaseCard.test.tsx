// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { queuedInvoice, REVIEWER, signedIn } from '../test/fixtures';
import type { CaseByNumber } from '../api/client';
import { CaseMatch } from './CaseCard';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const found = (overrides: Partial<CaseByNumber> = {}): CaseByNumber => ({
  caseId: 'case-1',
  caseNumber: 'DEMO-26-00103',
  otherNumbers: [],
  clientDisplayName: 'Casey Client',
  countyDisplayName: 'County A',
  closed: false,
  match: 'close',
  ...overrides,
});

const invoice = queuedInvoice({ invoiceId: 'inv-1', caseNumberAsTyped: 'DEMO2600103', caseNumberCorrected: null });

describe('matching an invoice to a case', () => {
  it('offers a close match and matches to the chosen case', async () => {
    const onMatched = vi.fn();
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/invoices/:id/case-matches': { cases: [found(), found({ caseId: 'case-2', caseNumber: 'DEMO-26-00108', clientDisplayName: 'Other Client' })] },
      'POST /api/invoices/intake/:id/case': { invoiceId: 'inv-1', caseId: 'case-2', addedProfessionalIds: [], released: false },
    });
    await renderPage(<CaseMatch invoice={invoice} onMatched={onMatched} />, { path: '/', url: '/' });

    expect(await screen.findByText(/No case in this tool has the number DEMO2600103\. These are close\./)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /DEMO-26-00103 · Casey Client, County A \(close match\)/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Match' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /DEMO-26-00108/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Match' }));

    await waitFor(() => expect(onMatched).toHaveBeenCalledWith('Matched to case DEMO-26-00108.'));
    expect(api.calls.find((call) => call.method === 'POST')!.body).toEqual({ caseId: 'case-2', addMissing: true });
  });

  it('never offers to start a case when none matches', async () => {
    fakeApi({ ...signedIn(REVIEWER), 'GET /api/invoices/:id/case-matches': { cases: [] } });
    await renderPage(<CaseMatch invoice={invoice} onMatched={() => {}} />, { path: '/', url: '/' });

    expect(await screen.findByText(/No case in this tool has the number DEMO2600103, or one close to it\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Match/ })).toBeNull();
    expect(screen.queryByText(/Add a case/)).toBeNull();
  });
});
