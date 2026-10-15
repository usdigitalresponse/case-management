import type { ParsedInvoice } from '../parsedInvoice';

// Where a slow extraction has got to, shown to the uploader.
export type ExtractionProgress =
  | { stage: 'reading' }
  | { stage: 'recognizing' | 'model'; page: number; pages: number };

export interface ExtractOptions {
  onProgress?: (progress: ExtractionProgress) => void;
}

// Reads a PDF invoice into proposed values, throwing
// UnreadableInvoiceFileError when it can't.
export interface InvoiceExtractor {
  id: string;
  version: string;
  // Runs within the app or the organization's own cloud account; only these
  // may be used in production.
  inBoundary: boolean;
  extract(bytes: Buffer, options?: ExtractOptions): Promise<ParsedInvoice>;
}
