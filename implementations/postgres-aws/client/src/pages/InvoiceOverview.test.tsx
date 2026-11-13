// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { REVIEWER, signedIn } from '../test/fixtures';
import type { InvoiceOverview as Overview } from '../api/client';
import InvoiceOverview from './InvoiceOverview';

afterEach(() => {
  cleanup();
  queryClient.clear();
});

const invoice = (n: number) => ({ invoiceId: `inv-${n}`, senderDisplayName: `Sender ${n}`, caseNumber: `26-CR-000${n}`, submittedTotal: '100.00' });

const overview: Overview = {
  steps: [
    { step: 'no_reviewer', count: 1, invoices: [invoice(1)] },
    { step: 'being_reviewed', count: 4, invoices: [invoice(2), invoice(3), invoice(4)] },
    { step: 'sign_off', count: 0, invoices: [] },
    { step: 'not_completed', count: 0, invoices: [] },
  ],
  changes: [{ invoiceId: 'inv-1', senderDisplayName: 'Sender 1', caseNumber: '26-CR-0001', periodStart: '2026-08-01', what: 'Sent, no reviewer yet', when: '2026-11-07T15:00:00Z', by: 'Sender 1' }],
};

describe('the invoice overview (design K47)', () => {
  it('shows each step with its invoices, a link to all of them, and recent changes', async () => {
    const api = fakeApi({ ...signedIn(REVIEWER), 'GET /api/invoices/overview': overview });
    await renderPage(<InvoiceOverview />, { path: '/invoice-overview', url: '/invoice-overview' });

    expect(await screen.findByText('Where every invoice is in review right now. 5 invoices are not finished.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No reviewer yet' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Sender 1' })[0]!.getAttribute('href')).toBe('/billing/inv-1');
    expect(screen.getByRole('link', { name: /See all 4/ }).getAttribute('href')).toBe('/?show=everyone');
    expect(screen.getAllByText('No invoices here.')).toHaveLength(1);
    expect(screen.getByText('No invoices here. They appear after sign-off.')).toBeTruthy();
    expect(screen.getByText('Sent, no reviewer yet')).toBeTruthy();
    expect(screen.getByText('26-CR-0001, Aug 2026')).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });
});
