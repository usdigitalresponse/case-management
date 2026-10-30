import { describe, expect, it } from 'vitest';
import type { InvoiceRecord } from '../api/client';
import { choiceFrom, INVOICE_SORTS, invoiceView } from './invoiceListView';

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
    caseExternalReference: null,
    caseClientDisplayName: null,
    professionalDisplayName: null,
    ...patch,
  }) as InvoiceRecord;

const invoices = [
  invoice('sent-early', { submittedAt: '2026-01-02T00:00:00Z', submittedTotal: '50.00', caseClientDisplayName: 'Zed Sample', caseNumber: 'CR-1' }),
  invoice('draft', { statusCode: 'draft', submittedTotal: '200.00', proposedCase: { clientName: 'Amy Sample', caseNumber: 'NEW-7' } }),
  invoice('sent-late', { submittedAt: '2026-03-02T00:00:00Z', submittedTotal: '125.00', statusCode: 'approved', periodStart: '2026-02-01' }),
  invoice('returned', { statusCode: 'draft', returnedReason: 'Add the case number.', professionalDisplayName: 'Synthetic Attorney' }),
];
const ids = (view: InvoiceRecord[]) => view.map((row) => row.invoiceId);
const view = (patch: Partial<Parameters<typeof invoiceView>[1]>) => ids(invoiceView(invoices, { query: '', filter: 'all', sort: 'recent', ...patch }));

describe('sorting and filtering your invoices', () => {
  it('puts unsent drafts first, then the most recently sent', () => {
    expect(view({})).toEqual(['draft', 'returned', 'sent-late', 'sent-early']);
    expect(view({ sort: 'oldest' })).toEqual(['sent-early', 'sent-late', 'draft', 'returned']);
  });

  it('sorts by amount, client and period, with missing values last', () => {
    expect(view({ sort: 'amount_desc' })).toEqual(['draft', 'sent-late', 'sent-early', 'returned']);
    expect(view({ sort: 'client' }).slice(0, 2)).toEqual(['draft', 'sent-early']);
    expect(view({ sort: 'period' })[0]).toBe('sent-late');
  });

  it('keeps drafts sent back apart from other drafts', () => {
    expect(view({ filter: 'changes' })).toEqual(['returned']);
    expect(view({ filter: 'drafts' })).toEqual(['draft']);
    expect(view({ filter: 'decided' })).toEqual(['sent-late']);
  });

  it('searches case numbers, clients and providers, including what was entered for a new case', () => {
    expect(view({ query: 'new-7' })).toEqual(['draft']);
    expect(view({ query: 'sample zed' })).toEqual(['sent-early']);
    expect(view({ query: 'attorney' })).toEqual(['returned']);
  });

  it('reads only known choices from the address', () => {
    expect(choiceFrom('client', INVOICE_SORTS, 'recent')).toBe('client');
    expect(choiceFrom('toString', INVOICE_SORTS, 'recent')).toBe('recent');
    expect(choiceFrom(null, INVOICE_SORTS, 'recent')).toBe('recent');
  });
});
