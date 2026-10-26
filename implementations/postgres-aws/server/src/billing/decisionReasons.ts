// Starting reasons for approving a line in part or rejecting it
// (model/rules.yaml decide_invoice_lines). Configurable reference data:
// administrators may deactivate these or add others.
export const RATE_REASON_CODE = 'rate_above_configured';
export const OTHER_REASON_CODE = 'other';

export const INVOICE_DECISION_REASONS = [
  { code: RATE_REASON_CODE, displayName: 'Rate is higher than the configured rate' },
  { code: 'not_billable', displayName: 'Part of the work is not billable' },
  { code: 'excessive_time', displayName: 'More time than the task needs' },
  { code: 'duplicate', displayName: 'Duplicate of another entry' },
  { code: 'block_billing', displayName: 'Several tasks billed together (block billing)' },
  { code: OTHER_REASON_CODE, displayName: 'Another reason. Explain in the note.' },
];
