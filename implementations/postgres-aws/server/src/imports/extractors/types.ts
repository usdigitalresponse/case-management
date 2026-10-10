import type { ParsedInvoice } from '../parsedInvoice';

// Reads a PDF invoice into proposed values, throwing
// UnreadableInvoiceFileError when it can't.
export interface InvoiceExtractor {
  id: string;
  version: string;
  // Runs within the app or the organization's own cloud account; only these
  // may be used in production.
  inBoundary: boolean;
  extract(bytes: Buffer): Promise<ParsedInvoice>;
}
