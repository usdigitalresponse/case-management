// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { queuedInvoice, REVIEWER, signedIn } from '../test/fixtures';
import { CaseNumberReview } from './CaseNumberReview';

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('an invoice whose file had no case number (design K69)', () => {
  it('says so, and the reviewer adds it in the box', async () => {
    const api = fakeApi({
      ...signedIn(REVIEWER),
      'GET /api/portal/counties': { counties: [] },
      'PUT /api/invoices/:id/case-number': { invoiceId: 'inv-1', caseNumberAsTyped: null, caseNumberCorrected: 'CR-26-2000' },
    });
    const onCorrected = vi.fn();
    const invoice = queuedInvoice({ caseNumberAsTyped: null, caseNumberCorrected: null, professionalDisplayName: 'Sam Rivera' });
    await renderPage(<CaseNumberReview invoice={invoice} matches={{ same: 0, close: 0 }} canCorrect onCorrected={onCorrected} />, { path: '/', url: '/' });

    expect(await screen.findByText('Sam Rivera’s file had no case number. Add it below. The tool then lists this invoice under that case.')).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Case number' });
    fireEvent.change(box, { target: { value: 'CR-26-2000' } });
    await waitFor(() => expect((box as HTMLInputElement).value).toBe('CR-26-2000'));
    fireEvent.blur(box);

    await waitFor(() => expect(onCorrected).toHaveBeenCalledWith('Case number CR-26-2000 added.'));
    expect(api.callsTo('PUT', '/api/invoices/inv-1/case-number')[0]?.body).toEqual({ caseNumber: 'CR-26-2000' });
  });
});
