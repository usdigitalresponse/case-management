// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi, type FakeRequest } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { queuedInvoice, REVIEWER, signedIn } from '../test/fixtures';
import type { QueueSummary, ReviewQueueItem } from '../api/client';
import InvoicesToReview from './InvoicesToReview';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const item = (overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
  ...queuedInvoice(),
  caseNumber: null,
  otherCaseNumbers: [],
  lineCount: 2,
  decidedCount: 0,
  beingEntered: false,
  discardable: false,
  openQuestionCount: 0,
  answeredQuestionCount: 0,
  approvedTotal: null,
  finishedAt: null,
  reviewer: null,
  holder: null,
  workingDaysWaiting: 3,
  flags: [],
  caseNumberMatches: { same: 0, close: 0 },
  match: null,
  ...overrides,
});

const summary: QueueSummary = {
  counts: { all: 12, mine: 4, unassigned: 3, flagged: null },
  counties: [],
  late: [],
  entering: [],
  waitingAlertWorkingDays: 10,
};

describe('invoices to review', () => {
  it('shows the first batch with the whole queue’s counts, and asks the server for a filter', async () => {
    const queue = (request: FakeRequest) =>
      request.query.get('show') === 'flagged'
        ? { items: [item({ invoiceId: 'inv-flagged', professionalDisplayName: 'Flagged Sender' })], next: null, summary }
        : { items: [item()], next: 'cursor-2', summary };
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/invoices': queue,
      'GET /api/invoices/intake': { items: [] },
      'GET /api/portal/counties': { counties: [] },
    });
    await renderPage(<InvoicesToReview />, { path: '/', url: '/' });

    expect(await screen.findByText('Sam Sender')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Everyone's/ }).textContent).toContain('12');
    expect(screen.getByRole('button', { name: /Assigned to you/ }).textContent).toContain('4');
    // Only the rows themselves can tell which have flags, so that tag has no count.
    expect(screen.getByRole('button', { name: /Has a flag/ }).textContent).toBe('Has a flag');
    expect(Object.fromEntries(api.calls.find((call) => call.path === '/api/invoices')!.query)).toEqual({ view: 'open', show: 'all', sort: 'waiting', counts: 'all,mine,unassigned,flagged' });

    fireEvent.click(screen.getByRole('button', { name: /Has a flag/ }));
    expect(await screen.findByText(/Flagged Sender/)).toBeTruthy();
    await waitFor(() => expect(api.calls.some((call) => call.path === '/api/invoices' && call.query.get('show') === 'flagged')).toBe(true));
  });
});
