import type { ReviewQueueItem } from './api/client';

// As a reviewer corrected it or the sender typed it, else the case's own
// number (invoices filed under a case).
export function shownCaseNumber(invoice: Pick<ReviewQueueItem, 'caseNumberAsTyped' | 'caseNumberCorrected' | 'caseNumber'>): string | null {
  return invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped ?? invoice.caseNumber;
}

// Ignores case, spaces, dashes and leading zeros, like the server's close match.
export function closeKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ''));
}

// The search results page (design G24), for a name or case number.
export function searchPath(query: string): string {
  return `/search?${new URLSearchParams({ q: query }).toString()}`;
}

// "Also on 3 other invoices. 1 close match." or null.
export function matchesNote({ same, close }: { same: number; close: number }): string | null {
  const parts = [
    same > 0 ? `Also on ${same} other ${same === 1 ? 'invoice' : 'invoices'}.` : null,
    close > 0 ? `${close} close ${close === 1 ? 'match' : 'matches'}.` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}
