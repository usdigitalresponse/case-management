// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryClient } from '../queryClient';
import { fakeApi } from '../test/fakeApi';
import { renderPage } from '../test/renderPage';
import { lineEditorRoutes, REVIEWER, SENDER } from '../test/fixtures';
import type { UploadRead } from '../api/client';
import UploadInvoices from './UploadInvoices';

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

const ready: UploadRead = {
  status: 'ready',
  file: { fileName: 'august.pdf', sizeBytes: 2048, format: 'document' },
  read: { lineCount: 3, invoiceNumber: 'A-17', caseNumber: '26-CR-0001', county: null, periodStart: '2026-08-01', periodEnd: '2026-08-31', statedTotal: 450 },
  cases: [],
  suggested: null,
};

describe('uploading an invoice', () => {
  it('files a read invoice under its sender with what was read, then opens it to check', async () => {
    const api = fakeApi({
      ...lineEditorRoutes(),
      'GET /auth/me': SENDER,
      'POST /api/portal/uploads': { uploadReadId: 'read-1' },
      'GET /api/portal/uploads/:id': ready,
      'POST /api/portal/uploads/:id/draft': { invoiceId: 'inv-9' },
    });
    const page = await renderPage(<UploadInvoices />, { path: '/portal/upload', url: '/portal/upload' });
    const input = (await screen.findByLabelText(/./, { selector: 'input[type="file"]' })) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'august.pdf', { type: 'application/pdf' })] } });

    const go = await screen.findByRole('button', { name: 'Continue' });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);

    await waitFor(() => expect(page.elsewhere()).toBe('/portal/invoices/inv-9'));
    expect(api.callsTo('POST', '/api/portal/uploads/read-1/draft')[0]?.body).toMatchObject({
      caseId: null,
      professionalId: 'p-sender',
      caseNumber: '26-CR-0001',
      invoiceNumber: 'A-17',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    });
    expect(api.unhandled).toEqual([]);
  });

  it('asks staff who billed it and how it arrived before filing anything', async () => {
    const api = fakeApi({
      ...lineEditorRoutes(),
      'GET /auth/me': REVIEWER,
      'GET /api/portal/receipt-channels': { channels: [{ code: 'email', displayName: 'Email' }] },
      'POST /api/portal/uploads': { uploadReadId: 'read-1' },
      'GET /api/portal/uploads/:id': ready,
      'POST /api/portal/uploads/:id/draft': { invoiceId: 'inv-9' },
    });
    await renderPage(<UploadInvoices />, { path: '/upload', url: '/upload' });
    const input = (await screen.findByLabelText(/./, { selector: 'input[type="file"]' })) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7'], 'august.pdf', { type: 'application/pdf' })] } });
    const go = await screen.findByRole('button', { name: 'Continue' });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(go);

    expect(await screen.findByText('Choose whose work it is.')).toBeTruthy();
    expect(screen.getByText('Choose how it arrived.')).toBeTruthy();
    expect(api.callsTo('POST', /\/draft$/)).toEqual([]);
    expect(api.unhandled).toEqual([]);
  });
});
