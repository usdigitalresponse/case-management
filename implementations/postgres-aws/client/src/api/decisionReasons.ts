// Reasons a reviewer gives for a decision, and their settings.
import { request } from './http';

// Which list a reason is on: approving in part, rejecting, both, or setting a case rate.
export type ReasonAppliesTo = 'approved_in_part' | 'rejected' | 'both' | 'case_rate';

export interface DecisionReason {
  code: string;
  displayName: string;
  appliesTo: ReasonAppliesTo;
}

export interface DecisionReasonSetting extends DecisionReason {
  reasonId: string;
  active: boolean;
}

export function listDecisionReasonSettings(): Promise<{ reasons: DecisionReasonSetting[] }> {
  return request('/api/settings/decision-reasons');
}

export function addDecisionReason(input: { displayName: string; appliesTo: ReasonAppliesTo }): Promise<DecisionReasonSetting> {
  return request('/api/settings/decision-reasons', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDecisionReason(
  reasonId: string,
  input: Partial<{ displayName: string; appliesTo: ReasonAppliesTo; active: boolean }>,
): Promise<DecisionReasonSetting> {
  return request(`/api/settings/decision-reasons/${reasonId}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function listDecisionReasons(): Promise<{ reasons: DecisionReason[] }> {
  return request('/api/invoices/decision-reasons');
}
