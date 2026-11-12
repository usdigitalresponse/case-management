import { request } from './http';
import { batchParams, type Batch } from './batches';

// The deployment's billing rules (server/src/billing/billingRules.ts).
export type RuleEnforcement = 'off' | 'warn' | 'require';

export type BillingRuleCode =
  | 'billing_codes'
  | 'time_increment'
  | 'daily_hour_cap'
  | 'long_entry'
  | 'billing_period'
  | 'mileage_distance'
  | 'travel_time_distance';

export interface BillingRule {
  code: BillingRuleCode;
  label: string;
  description: string;
  warnOnly: boolean;
  enforcement: RuleEnforcement;
  parameters: { increment?: number; hours?: number; withinMonth?: boolean; tolerancePercent?: number; averageSpeedMph?: number };
}

// Oldest first (server/src/billing/mileageRates.ts).
export interface MileageRate {
  ratePerMile: string;
  effectiveFrom: string;
}

export function listMileageRates(): Promise<{ rates: MileageRate[] }> {
  return request('/api/settings/mileage-rates');
}

// Adds a rate from a date rather than changing an earlier one.
export function addMileageRate(input: { ratePerMile: number; effectiveFrom: string }): Promise<MileageRate> {
  return request('/api/settings/mileage-rates', { method: 'POST', body: JSON.stringify(input) });
}

export function mileageRateOn(rates: MileageRate[], date: string): string | undefined {
  let found: string | undefined;
  for (const rate of rates) {
    if (rate.effectiveFrom <= date) {
      found = rate.ratePerMile;
    }
  }
  return found;
}

// Oldest first (server/src/billing/timeCategoryRates.ts). With none in force
// for a category, its time is priced at the hourly rate.
export type TimeCategory = 'travel' | 'waiting';

export type TimeCategoryBasis = 'hourly_rate' | 'percent_of_hourly_rate' | 'flat_rate';

export interface TimeCategoryRate {
  category: TimeCategory;
  basis: TimeCategoryBasis;
  percent: string | null;
  hourlyRate: string | null;
  effectiveFrom: string;
}

export function listTimeCategoryRates(): Promise<{ rates: TimeCategoryRate[] }> {
  return request('/api/settings/time-category-rates');
}

// Adds a setting from a date rather than changing an earlier one.
export function addTimeCategoryRate(input: {
  category: TimeCategory;
  basis: TimeCategoryBasis;
  percent?: number;
  hourlyRate?: number;
  effectiveFrom: string;
}): Promise<TimeCategoryRate> {
  return request('/api/settings/time-category-rates', { method: 'POST', body: JSON.stringify(input) });
}

// As server/src/billing/timeCategoryRates.ts prices it.
export function categoryRateOn(
  settings: TimeCategoryRate[],
  category: TimeCategory,
  date: string,
  hourlyRate: string | undefined,
): string | undefined {
  const setting = categoryRateIn(settings, category, date);
  if (setting?.basis === 'flat_rate') {
    return setting.hourlyRate ?? undefined;
  }
  if (hourlyRate === undefined) {
    return undefined;
  }
  if (setting?.basis === 'percent_of_hourly_rate') {
    return (Math.round(Number(hourlyRate) * Number(setting.percent)) / 100).toFixed(2);
  }
  return hourlyRate;
}

// The category's setting in force on a date; oldest first, so the last one started.
export function categoryRateIn(settings: TimeCategoryRate[], category: TimeCategory, date: string): TimeCategoryRate | undefined {
  return settings.filter((setting) => setting.category === category && setting.effectiveFrom <= date).at(-1);
}

export interface BillingCode {
  billingCodeId: string;
  code: string;
  displayName: string;
  active: boolean;
}

export interface RuleFinding {
  rule: BillingRuleCode;
  enforcement: 'warn' | 'require';
  message: string;
  invoiceLineId?: string;
}

export function getBillingRuleSettings(): Promise<{ rules: BillingRule[]; codes: BillingCode[] }> {
  return request('/api/settings/billing-rules');
}

export function setBillingRule(
  code: BillingRuleCode,
  input: { enforcement: RuleEnforcement; parameters: BillingRule['parameters'] },
): Promise<BillingRule> {
  return request(`/api/settings/billing-rules/${code}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function addBillingCode(input: { code: string; displayName: string }): Promise<BillingCode> {
  return request('/api/settings/billing-codes', { method: 'POST', body: JSON.stringify(input) });
}

export function setBillingCodeActive(billingCodeId: string, active: boolean): Promise<BillingCode> {
  return request(`/api/settings/billing-codes/${billingCodeId}`, { method: 'PUT', body: JSON.stringify({ active }) });
}

// The rules in force, active codes, and mileage, travel and waiting time rates, for firms entering invoices.
export function getPortalBillingRules(): Promise<{
  rules: BillingRule[];
  codes: Array<{ code: string; displayName: string }>;
  mileageRates: MileageRate[];
  timeCategoryRates: TimeCategoryRate[];
}> {
  return request('/api/portal/billing-rules');
}

export interface ReviewSettings {
  defaultReviewerUserAccountId: string | null;
  defaultSignOffUserAccountIds: string[];
  signOffBy: 'anyone' | 'approvers';
  signOffApproverUserAccountIds: string[];
  waitingAlertWorkingDays: number;
  timeLogBlocksApproval: boolean;
}

export function getReviewSettings(): Promise<ReviewSettings> {
  return request('/api/settings/review');
}

export function setReviewSettings(input: Partial<ReviewSettings>): Promise<ReviewSettings> {
  return request('/api/settings/review', { method: 'PUT', body: JSON.stringify(input) });
}

export interface StaffRolesResponse {
  roles: Array<{ roleId: string; displayName: string }>;
  // Deactivated accounts too.
  people: Array<{ userAccountId: string; displayName: string; email: string; active: boolean; roleId: string }>;
}

export function getStaffRoles(): Promise<StaffRolesResponse> {
  return request('/api/settings/staff-roles');
}

export function setStaffRole(userAccountId: string, roleId: string): Promise<unknown> {
  return request(`/api/settings/staff-roles/${userAccountId}`, { method: 'PUT', body: JSON.stringify({ roleId }) });
}

export function addStaffAccount(input: { displayName: string; email: string; roleId: string }): Promise<{ userAccountId: string }> {
  return request('/api/settings/staff', { method: 'POST', body: JSON.stringify(input) });
}

export function setStaffActive(userAccountId: string, active: boolean): Promise<unknown> {
  return request(`/api/settings/staff/${userAccountId}/active`, { method: 'PUT', body: JSON.stringify({ active }) });
}

// Deletes all data and recreates the demo data; ends the session.
export function resetDemoData(): Promise<unknown> {
  return request('/api/settings/demo/reset', { method: 'POST' });
}

export function getOwnDemoRole(): Promise<{ roles: StaffRolesResponse['roles']; roleId: string }> {
  return request('/api/settings/demo/role');
}

export function setOwnDemoRole(roleId: string): Promise<unknown> {
  return request('/api/settings/demo/role', { method: 'PUT', body: JSON.stringify({ roleId }) });
}

// An external user who may sign in with an emailed code (server/src/people/externalUsers.ts).
export interface ExternalUser {
  personId: string;
  displayName: string;
  email: string | null;
  kind: string | null;
  // Offices they send invoices for, as a billing delegate.
  delegateFor: Array<{ officeId: string; displayName: string }>;
  signInEnabled: boolean;
  hasSignedIn: boolean;
  signInChangedAt: string | null;
}

export function listExternalUsers(q: string, after: string | null): Promise<Batch<ExternalUser>> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  return request(`/api/settings/external-users?${batchParams(params, after)}`);
}

export function searchExternalUserCandidates(q: string): Promise<{ people: ExternalUser[] }> {
  return request(`/api/settings/external-users/candidates?${new URLSearchParams({ q: q.trim() })}`);
}

export function listDelegateOffices(): Promise<{ offices: Array<{ officeId: string; displayName: string }> }> {
  return request('/api/settings/external-users/offices');
}

export type TurnOnExternalSignIn =
  | { personId: string; email?: string }
  | { newProvider: { displayName: string; email: string; professionalKindId: string } }
  | { newDelegate: { displayName: string; email: string; officeId: string } };

export function turnOnExternalSignIn(input: TurnOnExternalSignIn): Promise<ExternalUser> {
  return request('/api/settings/external-users', { method: 'POST', body: JSON.stringify(input) });
}

export function setExternalSignIn(personId: string, signInEnabled: boolean): Promise<ExternalUser> {
  return request(`/api/settings/external-users/${personId}`, { method: 'PUT', body: JSON.stringify({ signInEnabled }) });
}

// Lets them also send invoices for an office's providers, from today.
export function addDelegateOffice(personId: string, officeId: string): Promise<ExternalUser> {
  return request(`/api/settings/external-users/${personId}/offices`, { method: 'POST', body: JSON.stringify({ officeId }) });
}

export function endDelegateOffice(personId: string, officeId: string): Promise<ExternalUser> {
  return request(`/api/settings/external-users/${personId}/offices/${officeId}/end`, { method: 'POST' });
}
