// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { lineEditorRoutes, portalInvoice, queuedInvoice, SENDER, signedIn } from '../test/fixtures';
import InvoiceSubmission from './InvoiceSubmission';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const openCheck = () => renderPage(<InvoiceSubmission />, { path: '/portal/invoices/:invoiceId', url: '/portal/invoices/inv-1' });

describe('sending an invoice', () => {
  it('saves edited lines, then sends only once the sender confirms it is true and correct', async () => {
    const api = fakeApi({
      ...lineEditorRoutes(),
      ...signedIn(SENDER),
      'GET /api/portal/invoices/:id': portalInvoice(),
      'GET /api/portal/receipt-channels': { channels: [] },
      'GET /api/my-cases': { cases: [], professionals: [] },
      'PUT /api/portal/invoices/:id': { invoiceId: 'inv-1' },
      'PUT /api/portal/invoices/:id/case-number': { invoiceId: 'inv-1', caseNumber: '26-CR-00261' },
      'POST /api/portal/invoices/:id/submit': { invoiceId: 'inv-1', status: 'submitted' },
    });
    await openCheck();
    fireEvent.change(await screen.findByDisplayValue('Client meeting'), { target: { value: 'Client meeting and call' } });
    // The sender may type the case number; the reviewer only gets it as a suggestion.
    fireEvent.change(screen.getByRole('textbox', { name: 'Case number' }), { target: { value: '26-CR-00261' } });

    // Enabled once the rates arrive, which may be after the lines.
    const start = screen.getByRole('button', { name: 'Send for review' }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send for review' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(api.callsTo('PUT', '/api/portal/invoices/inv-1')[0]?.body).toMatchObject({ lines: [{ description: 'Client meeting and call' }] });
    expect(api.callsTo('PUT', '/api/portal/invoices/inv-1/case-number')[0]?.body).toEqual({ caseNumber: '26-CR-00261' });

    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(send);

    await waitFor(() => expect(api.callsTo('POST', '/api/portal/invoices/inv-1/submit')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/portal/invoices/inv-1/submit')[0]?.body).toMatchObject({ attested: true, filedByPerson: true });
    expect(api.unhandled).toEqual([]);
  });

  it('saves edited lines before leaving to save it for later', async () => {
    const api = fakeApi({
      ...lineEditorRoutes(),
      ...signedIn(SENDER),
      'GET /api/portal/invoices/:id': portalInvoice(),
      'GET /api/portal/receipt-channels': { channels: [] },
      'GET /api/my-cases': { cases: [], professionals: [] },
      'PUT /api/portal/invoices/:id': { invoiceId: 'inv-1' },
    });
    const page = await openCheck();
    fireEvent.change(await screen.findByDisplayValue('Client meeting'), { target: { value: 'Client meeting and call' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save and finish later' }));

    await waitFor(() => expect(page.elsewhere()).toBe('/portal/invoices'));
    expect(api.callsTo('PUT', '/api/portal/invoices/inv-1')[0]?.body).toMatchObject({ lines: [{ description: 'Client meeting and call' }] });
    expect(api.unhandled).toEqual([]);
  });
});

describe('dates already billed', () => {
  it('warns the sender on a draft and links to their earlier invoice', async () => {
    const api = fakeApi({
      ...lineEditorRoutes(),
      ...signedIn(SENDER),
      'GET /api/portal/invoices/:id': portalInvoice({
        billingOverlaps: [
          {
            invoiceId: 'inv-2',
            sameCase: true,
            caseId: 'case-1',
            caseNumber: '26-CR-0001',
            invoiceNumber: 'INV-0042',
            professionalDisplayName: 'Synthetic Investigator',
            statusCode: 'submitted',
            statusDisplayName: 'Submitted',
            submittedAt: '2026-03-16T15:00:00Z',
            periodStart: '2026-03-01',
            periodEnd: '2026-03-15',
            submittedTotal: '300.00',
            lines: [],
          },
        ],
      }),
      'GET /api/portal/receipt-channels': { channels: [] },
      'GET /api/my-cases': { cases: [], professionals: [] },
    });
    await openCheck();

    expect(await screen.findByText('Some of these dates are already billed')).toBeTruthy();
    expect(screen.getByRole('link', { name: /invoice INV-0042/ }).getAttribute('href')).toBe('/portal/invoices/inv-2');
    expect(api.unhandled).toEqual([]);
  });
});

describe('a decided invoice', () => {
  it('shows the sign-off comment on an invoice filed under a case, not only one filed by person', async () => {
    const api = fakeApi({
      ...lineEditorRoutes(),
      ...signedIn(SENDER),
      'GET /api/portal/invoices/:id': portalInvoice({
        invoice: queuedInvoice({ caseNumberAsTyped: null, statusCode: 'approved', statusDisplayName: 'Approved' }),
        approvedTotal: '120.00',
        decisionComments: [{ outcomeCode: 'approved', comment: 'Approved with the write-up rate lowered.', decidedAt: '2026-11-01T10:00:00Z' }],
      }),
      'GET /api/portal/receipt-channels': { channels: [] },
      'GET /api/my-cases': { cases: [], professionals: [] },
    });
    await openCheck();
    expect(await screen.findByText('Approved with the write-up rate lowered.')).toBeTruthy();
    expect(screen.getByText('A comment on the invoice')).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });
});
