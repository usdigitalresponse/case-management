import type { InvoiceRecord } from '../api/client';

// As corrected or typed on the invoice, else its case's number, else one entered for a new case.
export function listCaseNumber(invoice: InvoiceRecord): string | null {
  return (
    invoice.caseNumberCorrected ??
    invoice.caseNumberAsTyped ??
    invoice.caseNumber ??
    invoice.caseExternalReference ??
    invoice.proposedCase?.caseNumber ??
    null
  );
}

// Unsent drafts first (the newest work), then the most recently sent.
export function inListOrder(invoices: InvoiceRecord[]): InvoiceRecord[] {
  return [...invoices].sort((a, b) => {
    if ((a.submittedAt === null) !== (b.submittedAt === null)) {
      return a.submittedAt === null ? -1 : 1;
    }
    return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
  });
}
