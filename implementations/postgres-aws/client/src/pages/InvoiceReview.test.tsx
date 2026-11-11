// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi, respond } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { approved, invoiceReview, lineEditorRoutes, queuedInvoice, REVIEWER, reviewLine, signedIn } from '../test/fixtures';
import InvoiceReview from './InvoiceReview';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const openReview = () => renderPage(<InvoiceReview />, { path: '/billing/:invoiceId', url: '/billing/inv-1' });

describe('reviewing an invoice', () => {
  it('records a decision, then shows the line as decided', async () => {
    const line = reviewLine();
    let current = invoiceReview({ lines: [line] });
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/decision-reasons': { reasons: [] },
      'GET /api/invoices/:id': () => current,
      'PUT /api/invoices/:id/lines/:lineId/decision': () => {
        current = invoiceReview({ lines: [{ ...line, working: approved(line) }] });
        return {};
      },
    });
    await openReview();

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Line 1 approved.')).toBeTruthy();
    const [decision] = api.callsTo('PUT', '/api/invoices/inv-1/lines/line-1/decision');
    expect(decision?.body).toMatchObject({ outcome: 'approved' });
    expect(api.unhandled).toEqual([]);
  });
});

describe('entering lines in review', () => {
  it('saves lines edited in place before deciding, with the version it holds', async () => {
    const line = reviewLine();
    const api = fakeApi({
      ...lineEditorRoutes(),
      ...signedIn(REVIEWER),
      'GET /api/decision-reasons': { reasons: [] },
      'GET /api/invoices/:id': () => invoiceReview({ lines: [line], entryOpen: true, invoice: queuedInvoice({ enteredInReview: true, linesVersion: 3 }) }),
      'PUT /api/invoices/:id/entered-lines': { invoiceId: 'inv-1', submittedTotal: '330.00', undecided: [], linesVersion: 4 },
      'PUT /api/invoices/:id/lines/:lineId/decision': {},
    });
    await openReview();
    const description = await screen.findByDisplayValue('Client meeting');
    fireEvent.change(description, { target: { value: 'Client meeting and travel' } });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(api.callsTo('PUT', '/api/invoices/inv-1/lines/line-1/decision')).toHaveLength(1));
    const order = api.calls.filter((call) => call.method === 'PUT').map((call) => call.path);
    expect(order).toEqual(['/api/invoices/inv-1/entered-lines', '/api/invoices/inv-1/lines/line-1/decision']);
    const [save] = api.callsTo('PUT', '/api/invoices/inv-1/entered-lines');
    expect(save?.body).toMatchObject({ linesVersion: 3, lines: [{ invoiceLineId: 'line-1', description: 'Client meeting and travel' }] });
    // The decision carries the version that save returned.
    expect(api.callsTo('PUT', '/api/invoices/inv-1/lines/line-1/decision')[0]?.body).toMatchObject({ outcome: 'approved', linesVersion: 4 });
    expect(api.unhandled).toEqual([]);
  });

  it('sends no decision when the save is refused as out of date, and reloads the lines', async () => {
    const line = reviewLine();
    const api = fakeApi({
      ...lineEditorRoutes(),
      ...signedIn(REVIEWER),
      'GET /api/decision-reasons': { reasons: [] },
      'GET /api/invoices/:id': () => invoiceReview({ lines: [line], entryOpen: true, invoice: queuedInvoice({ enteredInReview: true, linesVersion: 3 }) }),
      'PUT /api/invoices/:id/entered-lines': respond(409, { error: 'stale_lines', message: 'These lines changed since you opened them.' }),
      'PUT /api/invoices/:id/lines/:lineId/decision': {},
    });
    await openReview();
    fireEvent.change(await screen.findByDisplayValue('Client meeting'), { target: { value: 'Changed here' } });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(api.callsTo('GET', '/api/invoices/inv-1').length).toBeGreaterThan(1));
    expect(api.callsTo('PUT', /\/decision$/)).toEqual([]);
    expect(api.unhandled).toEqual([]);
  });
});

describe('possible double billing', () => {
  it('shows the other invoice, its overlapping lines and which line here they match', async () => {
    const line = reviewLine();
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/decision-reasons': { reasons: [] },
      'GET /api/invoices/:id': () =>
        invoiceReview({
          lines: [line],
          billingOverlaps: [
            {
              invoiceId: 'inv-2',
              sameCase: true,
              caseId: 'case-1',
              caseNumber: '26-CR-0001',
              invoiceNumber: 'INV-0042',
              professionalDisplayName: 'Synthetic Investigator',
              statusCode: 'approved',
              statusDisplayName: 'Approved',
              submittedAt: '2026-03-16T15:00:00Z',
              periodStart: '2026-03-01',
              periodEnd: '2026-03-15',
              submittedTotal: '300.00',
              lines: [
                {
                  invoiceLineId: 'other-1',
                  serviceDate: '2026-03-12',
                  lineTypeCode: 'time',
                  description: 'Wrote up the interview notes',
                  quantity: '1.50',
                  amount: '150.00',
                  workerDisplayName: 'Synthetic Investigator',
                  sameAsLineIds: ['line-1'],
                },
              ],
            },
          ],
        }),
    });
    await openReview();

    expect(await screen.findByText('Possible double billing')).toBeTruthy();
    expect(screen.getByRole('link', { name: /invoice INV-0042/ }).getAttribute('href')).toBe('/billing/inv-2');
    expect(screen.getByText(/1 line on the same dates, 1 with the same date, person and quantity/)).toBeTruthy();
    expect(screen.getByText('Wrote up the interview notes')).toBeTruthy();
    expect(screen.getByText('Line 1')).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });
});
