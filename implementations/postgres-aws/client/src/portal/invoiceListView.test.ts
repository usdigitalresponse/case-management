import { describe, expect, it } from 'vitest';
import type { InvoiceRecord } from '../api/client';
import { inListOrder, listCaseNumber } from './invoiceListView';

const invoice = (invoiceId: string, patch: Partial<InvoiceRecord>): InvoiceRecord =>
  ({
    invoiceId,
    returnedReason: null,
    proposedCase: null,
    caseId: 'c',
    statusCode: 'submitted',
    submittedAt: null,
    submittedTotal: '0.00',
    periodStart: null,
    caseNumber: null,
    caseNumberAsTyped: null,
    caseNumberCorrected: null,
    caseExternalReference: null,
    ...patch,
  }) as InvoiceRecord;

describe('your invoices', () => {
  it('puts unsent drafts first, then the most recently sent', () => {
    const invoices = [
      invoice('sent-early', { submittedAt: '2026-01-02T00:00:00Z' }),
      invoice('draft', { statusCode: 'draft' }),
      invoice('sent-late', { submittedAt: '2026-03-02T00:00:00Z' }),
    ];
    expect(inListOrder(invoices).map((row) => row.invoiceId)).toEqual(['draft', 'sent-late', 'sent-early']);
  });

  it('shows the case number as typed, else the case’s or one entered for a new case', () => {
    expect(listCaseNumber(invoice('a', { caseNumberAsTyped: '26CR340', caseNumber: '26-CR-00340' }))).toBe('26CR340');
    expect(listCaseNumber(invoice('b', { caseNumber: '26-CR-00340' }))).toBe('26-CR-00340');
    expect(listCaseNumber(invoice('c', { proposedCase: { clientName: 'Amy Sample', caseNumber: 'NEW-7' } }))).toBe('NEW-7');
    expect(listCaseNumber(invoice('d', {}))).toBeNull();
  });
});
