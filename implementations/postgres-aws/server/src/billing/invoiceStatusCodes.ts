// invoice_statuses codes the app itself acts on, provisioned in every
// environment by ../db/ensureReferenceData.ts.
export const SUBMITTED_INVOICE_STATUS_CODE = 'submitted';
export const APPROVED_INVOICE_STATUS_CODE = 'approved';
export const DRAFT_INVOICE_STATUS_CODE = 'draft';
export const REJECTED_INVOICE_STATUS_CODE = 'rejected';
export const WITHDRAWN_INVOICE_STATUS_CODE = 'withdrawn';
// The submitter's work in progress; hidden from staff and exports.
export const UNSUBMITTED_INVOICE_STATUS_CODES = [DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE];
