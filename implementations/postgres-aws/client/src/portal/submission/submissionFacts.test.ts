import { describe, expect, it } from 'vitest';
import type { PortalInvoice } from '../../api/client';
import { linesSummary, submissionFacts } from './submissionFacts';

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice: {
      invoiceId: 'i1',
      statusCode: 'draft',
      caseId: null,
      caseNumberAsTyped: null,
      submittedByUserAccountId: 'u1',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      professionalDisplayName: 'Sam Lee',
      professionalKindDisplayName: 'Attorney',
      proposedCase: null,
      ...overrides,
    },
    caseNumber: null,
  } as unknown as PortalInvoice;
}

describe('submissionFacts', () => {
  it('files an invoice without a case by person, and one under a case by its case', () => {
    expect(submissionFacts(invoice(), { userId: 'u1', staff: false, filedByPerson: undefined }).byPerson).toBe(true);
    expect(submissionFacts(invoice({ caseId: 'c1' }), { userId: 'u1', staff: false, filedByPerson: undefined }).byPerson).toBe(false);
    // Put under one of the sender's cases, it stays filed by person.
    expect(submissionFacts(invoice({ caseId: 'c1', caseNumberAsTyped: '26-CR-1' }), { userId: 'u1', staff: false, filedByPerson: undefined }).byPerson).toBe(true);
  });

  it('lets only the submitter edit a draft', () => {
    expect(submissionFacts(invoice(), { userId: 'u1', staff: false, filedByPerson: undefined }).editable).toBe(true);
    expect(submissionFacts(invoice(), { userId: 'u2', staff: false, filedByPerson: undefined }).editable).toBe(false);
    expect(submissionFacts(invoice({ statusCode: 'submitted' }), { userId: 'u1', staff: false, filedByPerson: undefined })).toMatchObject({ editable: false, sent: true });
  });

  it('leads staff back to their queue and submitters to their invoices', () => {
    expect(submissionFacts(invoice(), { userId: 'u1', staff: true, filedByPerson: true }).home.label).toBe('To review');
    expect(submissionFacts(invoice(), { userId: 'u1', staff: false, filedByPerson: true }).home.label).toBe('Your invoices');
  });

  it('names the month of the period', () => {
    expect(submissionFacts(invoice(), { userId: 'u1', staff: false, filedByPerson: undefined }).month).toBe('August 2026');
  });
});

describe('linesSummary', () => {
  it('counts the lines and what the sender changed', () => {
    expect(linesSummary(1, { changed: [], removed: [], added: [] })).toBe('1 line.');
    expect(linesSummary(3, { changed: [1], removed: [1], added: [1, 2] })).toBe('3 lines. You changed 1 and removed 1, and added 2.');
  });
});
