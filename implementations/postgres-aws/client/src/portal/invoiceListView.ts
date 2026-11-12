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
