// Identifies an uploaded invoice from its bytes, never its name or declared
// type, and rejects what can't be parsed safely (model/rules.yaml
// validate_invoice_import).
import { AppError } from '../errors';
import type { ParsedInvoice, ImportFormat } from './parsedInvoice';
import { UnreadableInvoiceFileError } from './parsedInvoice';
import { LEDES_1998B_SIGNATURE, parseLedes1998b } from './parseLedes';
import { looksLikeTemplateHeader, parseCsvRows, parseTemplateCsv, parseTemplateXlsx } from './parseSpreadsheet';
import { documentExtractor } from './extractors';

// Upload defaults (docs/invoice-import-export-plan.md "Upload defaults").
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class UnsupportedInvoiceFileError extends AppError {
  readonly status = 415;
  readonly code = 'unsupported_file';
}

export interface DetectedFile {
  format: ImportFormat;
  mediaType: string;
  extractionMethod: string;
  parse: () => Promise<ParsedInvoice>;
}

const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SPREADSHEET_METHOD = 'spreadsheet-template-parser 1';
const UNSUPPORTED_MESSAGE =
  'Upload a PDF invoice, a LEDES 1998B file, or the invoice spreadsheet template (CSV or XLSX).';

function startsWith(bytes: Buffer, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function detectInvoiceFile(bytes: Buffer): DetectedFile {
  if (bytes.length === 0) {
    throw new UnreadableInvoiceFileError('The file is empty.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new UnsupportedInvoiceFileError('Files must be 10 MB or smaller.');
  }
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    const extractor = documentExtractor();
    return {
      format: 'document',
      mediaType: 'application/pdf',
      extractionMethod: `${extractor.id} ${extractor.version}`,
      parse: () => extractor.extract(bytes),
    };
  }
  // Legacy .xls and password-protected Office files are OLE compound files.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new UnsupportedInvoiceFileError('Encrypted or older-format Excel files can’t be imported; save as .xlsx without a password.');
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // Zip entry names are stored uncompressed, so a byte search finds them.
    if (!bytes.includes('xl/workbook')) {
      throw new UnsupportedInvoiceFileError('Only .xlsx spreadsheets can be imported.');
    }
    if (bytes.includes('vbaProject.bin')) {
      throw new UnsupportedInvoiceFileError('Spreadsheets with macros can’t be imported; save as a plain .xlsx.');
    }
    return {
      format: 'spreadsheet',
      mediaType: XLSX_MEDIA_TYPE,
      extractionMethod: SPREADSHEET_METHOD,
      parse: () => parseTemplateXlsx(bytes),
    };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UnsupportedInvoiceFileError(UNSUPPORTED_MESSAGE);
  }
  if (text.replace(/^﻿/, '').startsWith(LEDES_1998B_SIGNATURE)) {
    return {
      format: 'ledes_1998b',
      mediaType: 'text/plain',
      extractionMethod: 'ledes-1998b-parser 1',
      parse: async () => parseLedes1998b(text),
    };
  }
  const [firstRow] = parseCsvRows(text.slice(0, 4096).split(/\r?\n/)[0] ?? '');
  if (firstRow && looksLikeTemplateHeader(firstRow)) {
    return { format: 'spreadsheet', mediaType: 'text/csv', extractionMethod: SPREADSHEET_METHOD, parse: async () => parseTemplateCsv(text) };
  }
  throw new UnsupportedInvoiceFileError(UNSUPPORTED_MESSAGE);
}
