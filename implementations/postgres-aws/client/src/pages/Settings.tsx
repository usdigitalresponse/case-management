import { useState, type FormEvent } from 'react';
import { Checkbox, Form, FormGroup, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  addBillingCode,
  addKindRate,
  addMileageRate,
  addTimeCategoryRate,
  apiErrorMessage,
  categoryRateIn,
  createProfessionalKind,
  mileageRateOn,
  rateOn,
  resetDemoData,
  setBillingCodeActive,
  setBillingRule,
  setOwnDemoRole,
  type BillingCode,
  type BillingRule,
  type ProfessionalKind,
  type RuleEnforcement,
  type TimeCategory,
  type TimeCategoryBasis,
} from '../api/client';
import { timeCategoryRateLabel } from '../components/InvoiceLinesEditor';
import { useResource } from '../hooks/useResource';
import { billingRuleSettings, mileageRates, ownDemoRole, professionalKinds, timeCategoryRates } from '../resources';
import { useAuth } from '../AuthContext';
import { PageHeading } from '../components/PageHeading';
import { useLocation } from 'react-router';
import { DecisionReasonSettings, ReviewRoutingSettings, RoleSummary, StaffRoleSettings } from '../components/ReviewSettings';
import { SegmentedChoice } from '../components/SegmentedChoice';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { formatMoney, formatRate } from '../formatMoney';
import { Notice, type SaveMessage } from '../components/Notice';
import { PreauthorizationThresholds } from '../components/PreauthorizationThresholds';

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
        <button type="submit" className="btn btn--outline" disabled={saving || !(Number(hourlyRate) > 0) || !effectiveFrom}>
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
        <button type="submit" className="btn btn--outline" disabled={saving || !displayName.trim()}>
          {saving ? 'Adding…' : 'Add kind'}
        </button>
      </div>
    </Form>
  );
}

export default function Settings({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(professionalKinds, { resetKey: version });
  const refresh = () => setVersion((v) => v + 1);
  const demoMode = Boolean(useAuth().user?.demoMode);

  return (
    <div>
      <PageHeading eyebrow="Administration" title="Settings" />
      <PageIndex sections={SECTIONS.filter((section) => section.id !== 'settings-demo' || demoMode)} />
      <Notice tone="info">Only administrators can change settings. Everyone on staff can read this page.</Notice>
      <section className="settings-section" id="settings-review">
        <h2>Invoice review</h2>
        <div className="settings-columns">
          <ReviewRoutingSettings isAdmin={isAdmin} />
          <DecisionReasonSettings isAdmin={isAdmin} />
        </div>
      </section>
      <section className="settings-section" id="settings-people">
        <h2>People who use this tool</h2>
        <RoleSummary />
        {isAdmin && <StaffRoleSettings />}
      </section>
      <section className="settings-section" id="settings-rates">
        <h2>Rates</h2>
        <p className="compact-hint">
          Time is invoiced at the hourly rate for each kind of professional on the date of the work. Travel and waiting
          time use their settings below, and mileage uses the rate per mile on the date of the trip. A rate set on a
          person's page takes the place of these for that person.
        </p>
        {Boolean(error) && <Notice tone="danger">Failed to load rates.</Notice>}
        {data && data.length === 0 && <p>No kinds of professional yet.</p>}
        <div className="settings-grid">
          {data?.map((kind) => <KindCard key={kind.professionalKindId} kind={kind} isAdmin={isAdmin} onChanged={refresh} />)}
          <MileageRates isAdmin={isAdmin} />
          <TimeCategoryRates category="travel" isAdmin={isAdmin} />
          <TimeCategoryRates category="waiting" isAdmin={isAdmin} />
        </div>
        {isAdmin && <AddKindForm onAdded={refresh} />}
      </section>
      <section className="settings-section" id="settings-preauthorization">
        <h2>Pre-authorization thresholds</h2>
        <p className="compact-hint">
          Up to the threshold, a provider's work on a case needs no pre-authorization. Senders must explain going past it, or
          past what's pre-authorized; the invoice is still reviewed.
        </p>
        <PreauthorizationThresholds isAdmin={isAdmin} />
      </section>
      <BillingRulesSettings isAdmin={isAdmin} />
      {demoMode && <DemoSettings isAdmin={isAdmin} />}
    </div>
  );
}

const SECTIONS = [
  { id: 'settings-review', label: 'Invoice review' },
  { id: 'settings-people', label: 'People who use this tool' },
  { id: 'settings-rates', label: 'Rates' },
  { id: 'settings-preauthorization', label: 'Pre-authorization thresholds' },
  { id: 'settings-rules', label: 'Billing rules and codes' },
  { id: 'settings-demo', label: 'Demo' },
];

// Links to each section; the one last chosen is shown as current.
function PageIndex({ sections }: { sections: typeof SECTIONS }) {
  const { hash } = useLocation();
  const current = hash.slice(1) || sections[0]?.id;
  return (
    <nav className="page-index" aria-label="On this page">
      <span>On this page:</span>
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} className={section.id === current ? 'is-current' : undefined} aria-current={section.id === current ? 'location' : undefined}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}

// Only on servers with the staff demo sign-in.
function DemoSettings({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className="settings-section" id="settings-demo">
      <h2>Demo</h2>
      <OwnRoleCard />
      {isAdmin && <DemoDataReset />}
    </section>
  );
}

// Anyone switches their own role to try each view; it applies at once.
function OwnRoleCard() {
  const { refreshUser } = useAuth();
  const [version, setVersion] = useState(0);
  const { data, error: loadError } = useResource(ownDemoRole, { resetKey: version });
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [saving, setSaving] = useState(false);

  async function change(roleId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await setOwnDemoRole(roleId);
      await refreshUser();
      setVersion((v) => v + 1);
      setMessage({ tone: 'success', text: 'Your role is changed.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'Your role could not be changed.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="compact-card">
      <h3>Your role</h3>
      <p className="compact-hint">
        Switch roles to try each view. Staff review and sign off; administrators also change settings.
      </p>
      {Boolean(loadError) && <Notice tone="danger">Failed to load your role.</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data && (
        <FormGroup>
          <Label htmlFor="own-demo-role">Role</Label>
          <Select id="own-demo-role" name="roleId" disabled={saving} value={data.roleId} onChange={(event) => void change(event.target.value)}>
            {data.roles.map((role) => (
              <option key={role.roleId} value={role.roleId}>
                {role.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>
      )}
    </section>
  );
}

// Accounts are recreated, so it signs out afterwards.
function DemoDataReset() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setResetting(true);
    setError(null);
    try {
      await resetDemoData();
      await logout();
    } catch (err) {
      setError(apiErrorMessage(err, 'The demo data could not be reset.'));
      setResetting(false);
    }
  }

  return (
    <section className="compact-card">
      <h3>Reset demo data</h3>
      <p className="compact-hint">
        Deletes every case, invoice, account and setting, including anything entered here, and recreates the
        synthetic demo data. Everyone is signed out.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {confirming ? (
        <>
          <Notice tone="warning">This can't be undone. Reset all data to the demo data?</Notice>
          <div className="close-case-buttons">
            <button type="button" className="btn btn--danger" disabled={resetting} onClick={() => void reset()}>
              {resetting ? 'Resetting…' : 'Yes, reset all data'}
            </button>
            <button type="button" className="btn btn--outline" disabled={resetting} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
          Reset demo data
        </button>
      )}
    </section>
  );
}

// Mileage is priced at the rate per mile in force on the trip's date.
function MileageRates({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error: loadError } = useResource(mileageRates, { resetKey: version });
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
            <button type="submit" className="btn btn--outline" disabled={saving || !(Number(ratePerMile) > 0) || !effectiveFrom}>
              {saving ? 'Saving…' : 'Add rate'}
            </button>
          </div>
        </Form>
      )}
    </section>
  );
}

// How travel or waiting time is priced from a date: the hourly rate, a
// percent of it or one flat rate (model/rules.yaml apply_time_category_rates).
function TimeCategoryRates({ category, isAdmin }: { category: TimeCategory; isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error: loadError } = useResource(timeCategoryRates, { resetKey: version });
  const [basis, setBasis] = useState<TimeCategoryBasis>('percent_of_hourly_rate');
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rates = data?.filter((rate) => rate.category === category);
  const current = data ? categoryRateIn(data, category, today()) : undefined;
  const needsAmount = basis !== 'hourly_rate';
  const name = category === 'travel' ? 'Travel time' : 'Waiting time';
  const id = (field: string) => `${category}-${field}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await addTimeCategoryRate({
        category,
        basis,
        effectiveFrom,
        ...(basis === 'percent_of_hourly_rate' && { percent: Number(amount) }),
        ...(basis === 'flat_rate' && { hourlyRate: Number(amount) }),
      });
      setAmount('');
      setVersion((v) => v + 1);
    } catch (err) {
      setError(apiErrorMessage(err, `The ${name.toLowerCase()} rate could not be saved.`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="compact-card settings-kind">
      <h3>{name}</h3>
      <p className="rate-note">
        {name} today: {timeCategoryRateLabel(current)}
      </p>
      {Boolean(loadError) && <Notice tone="danger">Failed to load {name.toLowerCase()} rates.</Notice>}
      {rates && (
        <RecordTable
          rows={[...rates].reverse()}
          rowKey={(rate) => `${rate.effectiveFrom}-${rate.basis}-${rate.percent}-${rate.hourlyRate}`}
          emptyMessage={`None set, so ${name.toLowerCase()} is invoiced at the hourly rate.`}
          columns={[
            { header: 'Applies from', render: (rate) => formatDate(rate.effectiveFrom) },
            { header: name, render: (rate) => timeCategoryRateLabel(rate) },
          ]}
        />
      )}
      {isAdmin && (
        <Form className="compact-form" onSubmit={(event) => void submit(event)}>
          {error && <Notice tone="danger">{error}</Notice>}
          <fieldset className="settings-basis">
            <legend>Invoice {name.toLowerCase()} at</legend>
            {(
              [
                ['hourly_rate', 'The hourly rate'],
                ['percent_of_hourly_rate', 'A percent of the hourly rate'],
                ['flat_rate', 'One rate per hour for everyone'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="radio-row">
                <input type="radio" name={id('basis')} checked={basis === value} onChange={() => setBasis(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="inline-fields rate-fields">
            {needsAmount && (
              <FormGroup>
                <Label htmlFor={id('amount')}>{basis === 'flat_rate' ? 'Rate per hour ($)' : 'Percent of hourly rate'}</Label>
                <TextInput
                  id={id('amount')}
                  name="amount"
                  type="number"
                  min="0.01"
                  max={basis === 'flat_rate' ? undefined : '100'}
                  step="0.01"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormGroup>
            )}
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
            <button type="submit" className="btn btn--outline" disabled={saving || (needsAmount && !(Number(amount) > 0)) || !effectiveFrom}>
              {saving ? 'Saving…' : 'Add setting'}
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
        <button type="submit" className="btn btn--outline" disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save'}
        </button>
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
            <button type="submit" className="btn btn--outline" disabled={!code.trim() || !displayName.trim()}>
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
        <div className="compact-card settings-rules">
          {data.rules.map((rule) => (
            <RuleCard key={rule.code} rule={rule} isAdmin={isAdmin} onSaved={refresh} />
          ))}
        </div>
      )}
      {data && <BillingCodes codes={data.codes} isAdmin={isAdmin} onChanged={refresh} />}
    </section>
  );
}
