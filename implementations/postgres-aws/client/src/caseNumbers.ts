import type { ReviewQueueItem } from './api/client';

// A reviewer's correction, else as typed, else the case's own number.
export function shownCaseNumber(invoice: Pick<ReviewQueueItem, 'caseNumberAsTyped' | 'caseNumberCorrected' | 'caseNumber'>): string | null {
  return invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped ?? invoice.caseNumber;
}

// "Also on 3 other invoices. 1 close match.", or null.
export function matchesNote({ same, close }: { same: number; close: number }): string | null {
  const parts = [
    same > 0 ? `Also on ${same} other ${same === 1 ? 'invoice' : 'invoices'}.` : null,
    close > 0 ? `${close} close ${close === 1 ? 'match' : 'matches'}.` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}
