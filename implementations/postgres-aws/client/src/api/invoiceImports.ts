import { fileBytes, request, sendFile } from './http';
import type { CountyChoice } from './cases';
import type { InvoiceLineType, InvoiceReceipt, ProposedCase, ProposedProvider, SourceRegion } from './myInvoices';

// --- Supporting invoice import ---------------------------------------------


export interface ImportWarning {
  code: string;
  message: string;
  location?: string;
}

export interface SuggestedImportLine {
  location: string;
  region?: SourceRegion;
  line_type?: { value: InvoiceLineType };
  service_date?: { value: string };
  description?: { value: string };
  quantity?: { value: number };
  unit_rate?: { value: number };
  amount: { value: number };
}

// Where a file still being read has got to (server/src/imports/extractionJobs.ts):
// waiting behind other files, reading, or recognizing a scan's text.
export type ImportProgress =
  | { stage: 'queued'; ahead: number }
  | { stage: 'reading' }
  | { stage: 'recognizing'; page: number; pages: number };

export interface InvoiceImportDetail {
  invoiceImportId: string;
  uploadedAt: string;
  caseId: string | null;
  statusCode: 'received' | 'extracted' | 'failed' | 'confirmed' | 'discarded';
  statusDisplayName: string;
  formatDisplayName: string;
  extractionMethod: string | null;
  extractedAt: string | null;
  extractionResult: {
    invoice?: { invoice_number?: { value: string } };
    lines?: Array<{ location: string; region?: SourceRegion }>;
    suggested_lines?: SuggestedImportLine[];
    warnings?: ImportWarning[];
    // Set when the file was designated to one professional: all their work.
    designated_professional_id?: string;
  } | null;
  invoiceId: string | null;
  resolvedAt: string | null;
  fileName: string;
  fileAvailable: boolean;
  expiresAt: string | null;
  // Set while the file is still being read (status received).
  progress: ImportProgress | null;
  possibleDuplicateTime: Array<{
    invoiceLineId: string;
    timeEntryId: string;
    activityOn: string;
    durationHours: string;
    description: string;
  }>;
}

// The file goes as the raw body; the server identifies it from its content.
// No case: the file waits on Intake until it is matched.
export function uploadInvoiceFile(
  caseId: string | null,
  file: File,
  professionalId?: string,
): Promise<{ invoiceImportId: string; status: string; invoiceId: string | null }> {
  const query = new URLSearchParams({ ...(caseId ? { caseId } : {}), ...(professionalId ? { professionalId } : {}) });
  return sendFile(`/api/portal/invoice-imports?${query.toString()}`, file);
}

export function getInvoiceImport(importId: string): Promise<InvoiceImportDetail> {
  return request<InvoiceImportDetail>(`/api/portal/invoice-imports/${importId}`);
}

// An import still in progress: unresolved, or confirmed with its draft not
// yet submitted (server/src/imports/invoiceImports/view.ts listInvoiceImports).
export interface ImportInProgress {
  invoiceImportId: string;
  uploadedAt: string;
  statusCode: string;
  fileName: string;
  caseId: string | null;
  caseExternalReference: string | null;
  caseClientDisplayName: string | null;
  invoiceId: string | null;
  invoiceStatusCode: string | null;
  professionalDisplayName: string | null;
  submittedTotal: string | null;
  // The file's own amounts, summed; differs when rates reprice time.
  statedTotal: string | null;
  lineCount: number;
  unmatchedCount: number;
  // Blank dates, and dates taken from the line before.
  undatedCount: number;
  inferredDateCount: number;
  warningCount: number;
  // Warnings other than the date notes above.
  otherWarningCount: number;
  // Why a failed import couldn't be read.
  failureMessage: string | null;
  expiresAt: string | null;
  // Set while the file is still being read (status received).
  progress: ImportProgress | null;
}

// A file for one professional whose lines name their cases
// (server/src/imports/splitByCase.ts).
export interface CaseSplitPreview {
  cases: Array<{ caseId: string; externalReference: string | null; clientDisplayName: string | null }>;
  lines: Array<{
    index: number;
    location: string;
    caseLabel: string | null;
    lineType: InvoiceLineType;
    serviceDate: string | null;
    description: string | null;
    quantity: number | null;
    // As the file states it.
    amount: number;
    // What will be billed: a time line at the professional's rate on its date.
    billedRate: string | null;
    billedAmount: number | null;
    suggestedCaseId: string | null;
  }>;
}

// The file is read in the background, like an upload; poll its read.
export function startCaseSplit(file: File, professionalId: string): Promise<{ splitReadId: string }> {
  const query = new URLSearchParams({ professionalId });
  return sendFile<{ splitReadId: string }>(`/api/portal/invoice-imports/case-split/reads?${query.toString()}`, file);
}

export type CaseSplitRead =
  | { status: 'reading'; progress: ImportProgress | null }
  | { status: 'failed'; failureMessage: string }
  | { status: 'ready'; preview: CaseSplitPreview };

// The portal upload (server/src/imports/splitByCase.ts): read first, then
// the submitter confirms its case, period and invoice number.
export interface UploadCase {
  caseId: string;
  professionalId: string;
  caseNumber: string | null;
  clientDisplayName: string | null;
  professionalDisplayName: string | null;
}

export interface UploadFile {
  fileName: string;
  sizeBytes: number;
  format: 'ledes_1998b' | 'spreadsheet' | 'document';
}

export type UploadRead =
  | { status: 'reading'; file: UploadFile; progress: ImportProgress | null }
  | { status: 'failed'; file: UploadFile; failureMessage: string }
  | {
      status: 'ready';
      file: UploadFile;
      read: {
        lineCount: number;
        invoiceNumber: string | null;
        caseNumber: string | null;
        // countyId null: named in the file but not listed yet.
        county: { countyId: string | null; displayName: string } | null;
        periodStart: string | null;
        periodEnd: string | null;
        statedTotal: number | null;
      };
      cases: UploadCase[];
      suggested: { caseId: string; professionalId: string } | null;
    };

export function startUpload(file: File): Promise<{ uploadReadId: string }> {
  return sendFile<{ uploadReadId: string }>('/api/portal/uploads', file);
}

export function listUploadCases(): Promise<{ cases: UploadCase[] }> {
  return request('/api/portal/uploads/cases');
}

export function getUpload(uploadReadId: string): Promise<UploadRead> {
  return request<UploadRead>(`/api/portal/uploads/${uploadReadId}`);
}

export function discardUpload(uploadReadId: string): Promise<{ splitReadId: string }> {
  return request(`/api/portal/uploads/${uploadReadId}`, { method: 'DELETE' });
}

export function createUploadDraft(
  uploadReadId: string,
  // Null case or professional: it waits on Intake to be matched.
  details: {
    caseId: string | null;
    professionalId: string | null;
    proposedCase?: ProposedCase;
    proposedProvider?: ProposedProvider;
    periodStart?: string;
    periodEnd?: string;
    invoiceNumber?: string;
    caseNumber?: string;
    // A reviewer's goes straight into their own review.
    enterInReview?: boolean;
  } & CountyChoice &
    InvoiceReceipt,
): Promise<{ invoiceImportId: string; invoiceId: string }> {
  return request(`/api/portal/uploads/${uploadReadId}/draft`, { method: 'POST', body: JSON.stringify(details) });
}

export function getCaseSplitRead(splitReadId: string): Promise<CaseSplitRead> {
  return request<CaseSplitRead>(`/api/portal/invoice-imports/case-split/reads/${splitReadId}`);
}

export function discardCaseSplitRead(splitReadId: string): Promise<{ splitReadId: string }> {
  return request(`/api/portal/invoice-imports/case-split/reads/${splitReadId}`, { method: 'DELETE' });
}

// One case per line, in the file's order; makes one import per case from
// the file and reading already on the server.
export function uploadInvoiceFileByCase(
  splitReadId: string,
  caseIds: string[],
): Promise<{ imports: Array<{ invoiceImportId: string; caseId: string; invoiceId: string }> }> {
  return request('/api/portal/invoice-imports/case-split', { method: 'POST', body: JSON.stringify({ splitReadId, caseIds }) });
}

export function listInvoiceImports(): Promise<{ imports: ImportInProgress[] }> {
  return request<{ imports: ImportInProgress[] }>('/api/portal/invoice-imports');
}

export function resolveInvoiceImport(importId: string, action: 'confirm' | 'discard'): Promise<{ invoiceImportId: string }> {
  return request<{ invoiceImportId: string }>(`/api/portal/invoice-imports/${importId}/${action}`, { method: 'POST' });
}

export type ImportPreview =
  | { kind: 'pdf' }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'rows'; rows: string[][]; truncated: boolean };

export function getImportPreview(importId: string): Promise<ImportPreview> {
  return request<ImportPreview>(`/api/portal/invoice-imports/${importId}/preview`);
}

export async function getImportFileBytes(importId: string): Promise<ArrayBuffer> {
  return fileBytes(invoiceImportFileUrl(importId));
}

export function invoiceImportFileUrl(importId: string): string {
  return `/api/portal/invoice-imports/${importId}/file`;
}

export function invoiceTemplateUrl(format: 'csv' | 'xlsx'): string {
  return `/api/portal/invoice-imports/template?format=${format}`;
}
