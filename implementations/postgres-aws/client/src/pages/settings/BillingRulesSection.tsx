import { useState, type FormEvent } from 'react';
import { Checkbox, Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import { addBillingCode, apiErrorMessage, setBillingCodeActive, setBillingRule, type BillingCode, type BillingRule, type RuleEnforcement } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { billingRuleSettings } from '../../resources';
import { SegmentedChoice } from '../../components/ui/SegmentedChoice';
import { RecordTable } from '../../components/RecordTable';
import { Notice, type SaveMessage } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';

// Each save adds a setting rather than changing one, so history is kept.
function RuleCard({ rule, isAdmin, onSaved }: { rule: BillingRule; isAdmin: boolean; onSaved: () => void }) {
  const [enforcement, setEnforcement] = useState<RuleEnforcement>(rule.enforcement);
  const [parameters, setParameters] = useState(rule.parameters);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const id = (field: string) => `rule-${rule.code}-${field}`;
  const changed = enforcement !== rule.enforcement || JSON.stringify(parameters) !== JSON.stringify(rule.parameters);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await setBillingRule(rule.code, { enforcement, parameters });
      setMessage({ tone: 'success', text: 'Saved. It applies to invoices confirmed or submitted from now on.' });
      onSaved();
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'The rule could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  const numberField = (key: 'increment' | 'hours' | 'tolerancePercent' | 'averageSpeedMph', label: string, step: string, min = step) => (
    <FormGroup>
      <Label htmlFor={id(key)}>{label}</Label>
      <TextInput
        id={id(key)}
        name={key}
        type="number"
        step={step}
        min={min}
        disabled={!isAdmin}
        value={String(parameters[key] ?? '')}
        onChange={(event) => setParameters({ ...parameters, [key]: Number(event.target.value) })}
      />
    </FormGroup>
  );

  return (
    <form className="settings-rule-row" onSubmit={(event) => void save(event)}>
      <div className="settings-rule-row__what">
        <h3>{rule.label}</h3>
        <p className="compact-hint">{rule.description}</p>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
      <SegmentedChoice<RuleEnforcement>
        label={`${rule.label} applies as`}
        disabled={!isAdmin}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'warn', label: 'Warn' },
          ...(rule.warnOnly ? [] : [{ value: 'require' as const, label: 'Require' }]),
        ]}
        value={enforcement}
        onChange={setEnforcement}
      />
      <div className="settings-rule-row__fields">
        {rule.code === 'time_increment' && numberField('increment', 'Increment (hours)', '0.01')}
        {(rule.code === 'daily_hour_cap' || rule.code === 'long_entry') && numberField('hours', 'Hours', '0.5')}
        {rule.code === 'mileage_distance' && numberField('tolerancePercent', 'Tolerance (%)', '1', '0')}
        {rule.code === 'travel_time_distance' && (
          <>
            {numberField('averageSpeedMph', 'Average speed (mph)', '1')}
            {numberField('tolerancePercent', 'Tolerance (%)', '1', '0')}
          </>
        )}
        {rule.code === 'billing_period' && (
          <Checkbox
            id={id('within-month')}
            name="withinMonth"
            label="Within one calendar month"
            disabled={!isAdmin}
            checked={Boolean(parameters.withinMonth)}
            onChange={(event) => setParameters({ ...parameters, withinMonth: event.target.checked })}
          />
        )}
      </div>
      {isAdmin && (
        <Button type="submit" kind="secondary" disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </form>
  );
}

function BillingCodes({ codes, isAdmin, onChanged }: { codes: BillingCode[]; isAdmin: boolean; onChanged: () => void }) {
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await addBillingCode({ code: code.trim(), displayName: displayName.trim() });
      setCode('');
      setDisplayName('');
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, 'The code could not be added.'));
    }
  }

  async function toggle(row: BillingCode) {
    setError(null);
    try {
      await setBillingCodeActive(row.billingCodeId, !row.active);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, 'The code could not be changed.'));
    }
  }

  return (
    <section className="settings-codes">
      <h2>Billing codes</h2>
      <p className="compact-hint">
        The task codes people choose from when the billing codes rule is on, such as a standard legal billing code set.
        Retired codes stay on invoices that used them.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <RecordTable
        rows={codes}
        rowKey={(row) => row.billingCodeId}
        emptyMessage="No codes yet."
        columns={[
          { header: 'Code', render: (row) => row.code },
          { header: 'Description', render: (row) => row.displayName },
          { header: 'In use', render: (row) => (row.active ? 'Yes' : 'Retired') },
          ...(isAdmin
            ? [
                {
                  header: '',
                  render: (row: BillingCode) => (
                    <button type="button" className="link-button" onClick={() => void toggle(row)}>
                      {row.active ? 'Retire' : 'Restore'}
                    </button>
                  ),
                },
              ]
            : []),
        ]}
      />
      {isAdmin && (
        <Form className="compact-form" onSubmit={(event) => void add(event)}>
          <div className="inline-fields rate-fields">
            <FormGroup>
              <Label htmlFor="new-code">Code</Label>
              <TextInput id="new-code" name="code" type="text" value={code} onChange={(event) => setCode(event.target.value)} />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="new-code-name">Description</Label>
              <TextInput
                id="new-code-name"
                name="displayName"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormGroup>
            <Button type="submit" kind="secondary" disabled={!code.trim() || !displayName.trim()}>
              Add code
            </Button>
          </div>
        </Form>
      )}
    </section>
  );
}

export function BillingRulesSettings({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(billingRuleSettings, { resetKey: version });
  const refresh = () => setVersion((v) => v + 1);
  return (
    <section className="settings-section" id="settings-rules">
      <h2>Billing rules</h2>
      <p className="compact-hint">
        Each rule is off unless turned on. Warn shows the finding to the people sending invoices and to reviewers.
        Require also stops an invoice being sent until it is fixed. Sent invoices keep the rules they were checked against.
      </p>
      {Boolean(error) && <Notice tone="danger">Failed to load billing rules.</Notice>}
      {data && (
        <div className="card compact-card settings-rules">
          {data.rules.map((rule) => (
            <RuleCard key={rule.code} rule={rule} isAdmin={isAdmin} onSaved={refresh} />
          ))}
        </div>
      )}
      {data && <BillingCodes codes={data.codes} isAdmin={isAdmin} onChanged={refresh} />}
    </section>
  );
}
