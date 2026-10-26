import { useState, type FormEvent } from 'react';
import { Checkbox, Form, FormGroup, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  addBillingCode,
  addKindRate,
  addMileageRate,
  apiErrorMessage,
  createProfessionalKind,
  getBillingRuleSettings,
  listMileageRates,
  listProfessionalKinds,
  mileageRateOn,
  rateOn,
  setBillingCodeActive,
  setBillingRule,
  type BillingCode,
  type BillingRule,
  type ProfessionalKind,
  type RuleEnforcement,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { DecisionReasonSettings, ReviewRoutingSettings, StaffRoleSettings } from '../components/ReviewSettings';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { formatMoney, formatRate } from '../formatMoney';
import { Notice, type SaveMessage } from '../components/Notice';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// A new rate applies from its date; earlier rates stay for earlier work.
function AddRateForm({ kind, onAdded }: { kind: ProfessionalKind; onAdded: () => void }) {
  const [hourlyRate, setHourlyRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = (field: string) => `kind-${kind.professionalKindId}-${field}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await addKindRate(kind.professionalKindId, { hourlyRate: Number(hourlyRate), effectiveFrom });
      setHourlyRate('');
      onAdded();
    } catch (err) {
      setError(apiErrorMessage(err, 'The rate could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Form className="compact-form" onSubmit={(event) => void submit(event)}>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="inline-fields rate-fields">
        <FormGroup>
          <Label htmlFor={id('rate')}>New hourly rate ($)</Label>
          <TextInput
            id={id('rate')}
            name="hourlyRate"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={hourlyRate}
            onChange={(event) => setHourlyRate(event.target.value)}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor={id('from')}>Applies from</Label>
          <input
            id={id('from')}
            name="effectiveFrom"
            type="date"
            className="usa-input"
            required
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </FormGroup>
        <button type="submit" className="btn btn--primary"disabled={saving || !(Number(hourlyRate) > 0) || !effectiveFrom}>
          {saving ? 'Saving…' : 'Add rate'}
        </button>
      </div>
    </Form>
  );
}

function KindCard({ kind, isAdmin, onChanged }: { kind: ProfessionalKind; isAdmin: boolean; onChanged: () => void }) {
  const current = rateOn(kind.rates, today());
  return (
    <section className="compact-card settings-kind">
      <h3>{kind.displayName}</h3>
      <p className="rate-note">Hourly rate today: {current ? formatMoney(current) : 'not set'}</p>
      <RecordTable
        rows={[...kind.rates].reverse()}
        rowKey={(rate) => `${rate.effectiveFrom}-${rate.hourlyRate}`}
        emptyMessage="No rates yet, so this kind's time can't be invoiced."
        columns={[
          { header: 'Applies from', render: (rate) => formatDate(rate.effectiveFrom) },
          { header: 'Hourly rate', render: (rate) => <span className="amount">{formatMoney(rate.hourlyRate)}</span> },
        ]}
      />
      {isAdmin && <AddRateForm kind={kind} onAdded={onChanged} />}
    </section>
  );
}

function AddKindForm({ onAdded }: { onAdded: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createProfessionalKind(displayName.trim());
      setDisplayName('');
      onAdded();
    } catch (err) {
      setError(apiErrorMessage(err, 'The kind could not be added.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Form className="compact-form compact-card" onSubmit={(event) => void submit(event)}>
      <h3>Add a kind of professional</h3>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="inline-fields rate-fields">
        <FormGroup>
          <Label htmlFor="new-kind-name">Name</Label>
          <TextInput
            id="new-kind-name"
            name="displayName"
            type="text"
            required
            placeholder="For example, Investigator"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </FormGroup>
        <button type="submit" className="btn btn--primary"disabled={saving || !displayName.trim()}>
          {saving ? 'Adding…' : 'Add kind'}
        </button>
      </div>
    </Form>
  );
}

export default function Settings({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => listProfessionalKinds().then((result) => result.kinds), [version]);
  const refresh = () => setVersion((v) => v + 1);

  return (
    <div>
      <PageHeading eyebrow="Administration" title="Settings" />
      {!isAdmin && <Notice tone="info">Only administrators can change settings.</Notice>}
      <section className="settings-section">
        <h2>Invoice review</h2>
        <ReviewRoutingSettings isAdmin={isAdmin} />
        <DecisionReasonSettings isAdmin={isAdmin} />
        {isAdmin && <StaffRoleSettings />}
      </section>
      <section className="settings-section">
        <h2>Rates</h2>
        <p className="compact-hint">
          Time is invoiced at the hourly rate for each professional's kind on the date of the work, and mileage at the
          rate per mile on the date of the trip. Give each provider a kind on the Providers page.
        </p>
        {Boolean(error) && <Notice tone="danger">Failed to load rates.</Notice>}
        {data && data.length === 0 && <p>No kinds of professional yet.</p>}
        {data?.map((kind) => <KindCard key={kind.professionalKindId} kind={kind} isAdmin={isAdmin} onChanged={refresh} />)}
        {isAdmin && <AddKindForm onAdded={refresh} />}
        <MileageRates isAdmin={isAdmin} />
      </section>
      <BillingRulesSettings isAdmin={isAdmin} />
    </div>
  );
}

// Mileage is priced at the rate per mile in force on the trip's date.
function MileageRates({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error: loadError } = useApiResource(() => listMileageRates().then((result) => result.rates), [version]);
  const [ratePerMile, setRatePerMile] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = data ? mileageRateOn(data, today()) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await addMileageRate({ ratePerMile: Number(ratePerMile), effectiveFrom });
      setRatePerMile('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError(apiErrorMessage(err, 'The rate could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="compact-card settings-kind">
      <h3>Mileage</h3>
      <p className="rate-note">Rate per mile today: {current ? formatRate(current) : 'not set'}</p>
      {Boolean(loadError) && <Notice tone="danger">Failed to load mileage rates.</Notice>}
      {data && (
        <RecordTable
          rows={[...data].reverse()}
          rowKey={(rate) => `${rate.effectiveFrom}-${rate.ratePerMile}`}
          emptyMessage="No rate yet, so mileage can't be invoiced."
          columns={[
            { header: 'Applies from', render: (rate) => formatDate(rate.effectiveFrom) },
            { header: 'Rate per mile', render: (rate) => <span className="amount">{formatRate(rate.ratePerMile)}</span> },
          ]}
        />
      )}
      {isAdmin && (
        <Form className="compact-form" onSubmit={(event) => void submit(event)}>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="inline-fields rate-fields">
            <FormGroup>
              <Label htmlFor="mileage-rate">New rate per mile ($)</Label>
              <TextInput
                id="mileage-rate"
                name="ratePerMile"
                type="number"
                min="0.001"
                step="0.001"
                required
                value={ratePerMile}
                onChange={(event) => setRatePerMile(event.target.value)}
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="mileage-from">Applies from</Label>
              <input
                id="mileage-from"
                name="effectiveFrom"
                type="date"
                className="usa-input"
                required
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </FormGroup>
            <button type="submit" className="btn btn--primary"disabled={saving || !(Number(ratePerMile) > 0) || !effectiveFrom}>
              {saving ? 'Saving…' : 'Add rate'}
            </button>
          </div>
        </Form>
      )}
    </section>
  );
}

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

  const numberField = (key: 'increment' | 'hours' | 'tolerancePercent', label: string, step: string, min = step) => (
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
    <Form className="compact-form compact-card settings-rule" onSubmit={(event) => void save(event)}>
      <h3>{rule.label}</h3>
      <p className="compact-hint">{rule.description}</p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="inline-fields rule-fields">
        <FormGroup>
          <Label htmlFor={id('enforcement')}>Applies as</Label>
          <Select
            id={id('enforcement')}
            name="enforcement"
            disabled={!isAdmin}
            value={enforcement}
            onChange={(event) => setEnforcement(event.target.value as RuleEnforcement)}
          >
            <option value="off">Off</option>
            <option value="warn">Warn</option>
            {!rule.warnOnly && <option value="require">Require</option>}
          </Select>
        </FormGroup>
        {rule.code === 'time_increment' && numberField('increment', 'Increment (hours)', '0.01')}
        {(rule.code === 'daily_hour_cap' || rule.code === 'long_entry') && numberField('hours', 'Hours', '0.5')}
        {rule.code === 'mileage_distance' && numberField('tolerancePercent', 'Tolerance (%)', '1', '0')}
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
        {isAdmin && (
          <button type="submit" className="btn btn--primary"disabled={saving || !changed}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </Form>
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
    <section className="compact-card">
      <h3>Billing codes</h3>
      <p className="compact-hint">
        The task codes firms choose from when the billing codes rule is on, such as a standard legal billing code set.
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
            <button type="submit" className="btn btn--primary"disabled={!code.trim() || !displayName.trim()}>
              Add code
            </button>
          </div>
        </Form>
      )}
    </section>
  );
}

function BillingRulesSettings({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => getBillingRuleSettings(), [version]);
  const refresh = () => setVersion((v) => v + 1);
  return (
    <section className="settings-section">
      <h2>Billing rules</h2>
      <p className="compact-hint">
        Each rule is off unless turned on. Warn shows the finding to firms and reviewers; require also blocks import
        confirmation and submission until it's fixed. Submitted invoices keep the rules they were checked against.
      </p>
      {Boolean(error) && <Notice tone="danger">Failed to load billing rules.</Notice>}
      {data?.rules.map((rule) => (
        <RuleCard key={rule.code} rule={rule} isAdmin={isAdmin} onSaved={refresh} />
      ))}
      {data && <BillingCodes codes={data.codes} isAdmin={isAdmin} onChanged={refresh} />}
    </section>
  );
}
