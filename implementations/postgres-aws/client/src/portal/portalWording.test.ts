import { describe, expect, it } from 'vitest';
import type { InvoiceRecord } from '../api/client';
import { formatSpan, submissionStatus } from './portalWording';

const invoice = (patch: Partial<InvoiceRecord>): InvoiceRecord => ({
  invoiceId: 'i',
  caseId: 'c',
  statusId: 's',
  statusCode: 'draft',
  statusDisplayName: 'Draft',
  submittedAt: null,
  submittedTotal: '100.00',
  periodStart: null,
  periodEnd: null,
  lastSubmittedAt: null,
  deletable: true,
  caseClientDisplayName: null,
  caseExternalReference: null,
  professionalDisplayName: null,
  submittedByUserAccountId: 'u',
  caseNumber: null,
  import: null,
  reviewerDisplayName: null,
  approvedTotal: null,
  cutLineCount: null,
  changes: null,
  ...patch,
});

describe('formatSpan', () => {
  it('shortens a period within one month or year', () => {
    expect(formatSpan('2026-09-01', '2026-09-30')).toBe('1 to 30 Sep 2026');
    expect(formatSpan('2026-08-01', '2026-09-30')).toBe('1 Aug to 30 Sep 2026');
    expect(formatSpan('2025-12-01', '2026-01-31')).toBe('1 Dec 2025 to 31 Jan 2026');
    expect(formatSpan(null, null)).toBe('—');
  });
});

describe('submissionStatus', () => {
  it('uses the review side’s words', () => {
    expect(submissionStatus(invoice({ import: { invoiceImportId: 'x', statusCode: 'extracted' } }))).toMatchObject({
      label: 'Draft, not sent',
      note: 'Lines not checked yet.',
    });
    expect(
      submissionStatus(
        invoice({
          import: { invoiceImportId: 'x', statusCode: 'extracted' },
          changes: { changedCount: 1, removedCount: 1, addedCount: 0 },
        }),
      ).note,
    ).toBe('You changed 1 line and removed 1.');
    expect(submissionStatus(invoice({ statusCode: 'submitted' })).label).toBe('Waiting for review');
    expect(submissionStatus(invoice({ statusCode: 'under_review', reviewerDisplayName: 'A Reviewer' }))).toMatchObject({
      label: 'Being reviewed',
      note: 'Reviewer: A Reviewer',
    });
    expect(submissionStatus(invoice({ statusCode: 'approved', approvedTotal: '1980.00', cutLineCount: 1 }))).toMatchObject({
      label: 'Decided',
      note: '$1,980.00 approved. 1 line cut.',
    });
  });
});
