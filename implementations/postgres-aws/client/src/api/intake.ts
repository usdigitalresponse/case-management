// Intake: requests waiting to be matched, matched to a case or returned.
import { request } from './http';
import type { ProposedCase, ProposedProvider } from './myInvoices';

// 'awaiting_match': sent, but waiting on Intake for what wasn't listed.
export type SendStatus = 'draft' | 'submitted' | 'awaiting_match';

// Intake: invoices held until they are matched to a case.
export interface IntakeItem {
  invoiceId: string | null;
  invoiceImportId: string | null;
  fileName: string | null;
  // 'sent': sent for matching by its submitter.
  stage: 'reading' | 'unreadable' | 'to_confirm' | 'ready' | 'sent';
  caseId: string | null;
  proposedCase: ProposedCase | null;
  proposedProvider: ProposedProvider | null;
  unlistedTimekeepers: Array<{ invoiceLineId: string; name: string; email: string | null; description: string | null }>;
  professionalId: string | null;
  professionalDisplayName: string | null;
  enteredByUserAccountId: string;
  enteredByDisplayName: string | null;
  enteredAt: string;
  receivedViaDisplayName: string | null;
  receivedOn: string | null;
  submittedTotal: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  suggestedCaseId: string | null;
  suggestedProfessionalId: string | null;
}

export function listInvoiceIntake(): Promise<{ items: IntakeItem[] }> {
  return request('/api/invoices/intake');
}

// addMissing adds the invoice's providers to the case when they aren't on it.
// professionalId: whom it bills, when it was saved without one.
// Back to its submitter's drafts, with what to change (staff only).
export function returnToSubmitter(invoiceId: string, reason: string) {
  return request<{ invoiceId: string }>(`/api/invoices/intake/${invoiceId}/return`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// timekeepers: who did the work, by line, for lines naming someone unlisted.
// released: it went on to review.
export function matchInvoiceToCase(
  invoiceId: string,
  input: { caseId: string; addMissing?: boolean; professionalId?: string; timekeepers?: Record<string, string> },
) {
  return request<{ invoiceId: string; caseId: string; addedProfessionalIds: string[]; released: boolean; releaseProblem?: string }>(`/api/invoices/intake/${invoiceId}/case`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
