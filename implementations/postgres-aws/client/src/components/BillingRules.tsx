import { type BillingRule, type RuleFinding } from '../api/client';
import { useResource } from '../hooks/useResource';
import { portalBillingRules } from '../resources';
import { Notice } from './ui/Notice';

// The rules in force for invoice entry, and the code list when codes are in use.
export function usePortalBillingRules() {
  const { data } = useResource(portalBillingRules);
  const rules = data?.rules ?? [];
  return {
    rules,
    codes: rules.some((rule) => rule.code === 'billing_codes') ? (data?.codes ?? []) : [],
    mileageRates: data?.mileageRates ?? [],
    timeCategoryRates: data?.timeCategoryRates ?? [],
  };
}

// One rule in plain words, as firms see it.
export function ruleSummary(rule: BillingRule): string {
  const { increment, hours, withinMonth, tolerancePercent, averageSpeedMph } = rule.parameters;
  const text = {
    billing_codes: "a task code from the agency's list on each time item, including travel time",
    time_increment: `time in steps of ${increment} hours`,
    daily_hour_cap: `at most ${hours} h per person per day`,
    long_entry: `single entries over ${hours} h are flagged`,
    billing_period: withinMonth ? 'a billing period within one calendar month' : 'a billing period',
    mileage_distance: `mileage within ${tolerancePercent}% of the driving route between From and To`,
    travel_time_distance: `travel hours within ${tolerancePercent}% of the trip's distance at ${averageSpeedMph} mph`,
  }[rule.code];
  return rule.enforcement === 'require' ? `${text} (required)` : text;
}

export function RulesInForce({ rules }: { rules: BillingRule[] }) {
  if (rules.length === 0) {
    return null;
  }
  return (
    <p className="rate-note">
      Agency billing rules: {rules.map(ruleSummary).join(' · ')}.
    </p>
  );
}

// What the rules found: warnings to check, and anything that must be fixed
// before confirming or submitting.
export function RuleFindings({
  findings,
  submitted = false,
  fixBefore = 'submitting',
}: {
  findings: RuleFinding[];
  submitted?: boolean;
  // What required findings block, when not yet submitted.
  fixBefore?: string;
}) {
  if (findings.length === 0) {
    return null;
  }
  const required = findings.filter((finding) => finding.enforcement === 'require');
  const warnings = findings.filter((finding) => finding.enforcement === 'warn');
  return (
    <>
      {required.length > 0 && (
        <Notice tone="danger" className="rule-findings" heading={submitted ? 'Required by billing rules:' : `Fix before ${fixBefore}:`}>
          <ul>
            {required.map((finding, index) => (
              <li key={index}>{finding.message}</li>
            ))}
          </ul>
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="warning" className="rule-findings" heading={submitted ? 'Billing rule warnings when submitted:' : 'Billing rule warnings:'}>
          <ul>
            {warnings.map((finding, index) => (
              <li key={index}>{finding.message}</li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
}
