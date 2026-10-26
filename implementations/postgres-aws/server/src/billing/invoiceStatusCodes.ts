// invoice_statuses codes the app itself acts on, provisioned in every
// environment by ../db/ensureReferenceData.ts.
export const SUBMITTED_INVOICE_STATUS_CODE = 'submitted';
export const UNDER_REVIEW_INVOICE_STATUS_CODE = 'under_review';
export const AWAITING_SIGN_OFF_INVOICE_STATUS_CODE = 'awaiting_sign_off';
export const APPROVED_INVOICE_STATUS_CODE = 'approved';
export const DRAFT_INVOICE_STATUS_CODE = 'draft';
export const REJECTED_INVOICE_STATUS_CODE = 'rejected';
export const WITHDRAWN_INVOICE_STATUS_CODE = 'withdrawn';
// The submitter's work in progress; hidden from staff and exports.
export const UNSUBMITTED_INVOICE_STATUS_CODES = [DRAFT_INVOICE_STATUS_CODE, WITHDRAWN_INVOICE_STATUS_CODE];
// Lines may be decided: before the round is finished and sent for sign-off.
export const LINE_REVIEW_STATUS_CODES = [SUBMITTED_INVOICE_STATUS_CODE, UNDER_REVIEW_INVOICE_STATUS_CODE];
// Waiting on staff: the review queue.
export const IN_REVIEW_INVOICE_STATUS_CODES = [...LINE_REVIEW_STATUS_CODES, AWAITING_SIGN_OFF_INVOICE_STATUS_CODE];
