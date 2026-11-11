import { useState, type FormEvent } from 'react';
import { Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import { addKindRate, apiErrorMessage, createProfessionalKind, rateOn, type ProfessionalKind } from '../../api/client';
import { RecordTable } from '../../components/RecordTable';
import { formatDate } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import { Notice } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import { today } from './today';

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
        <Button type="submit" kind="secondary" disabled={saving || !(Number(hourlyRate) > 0) || !effectiveFrom}>
          {saving ? 'Saving…' : 'Add rate'}
        </Button>
      </div>
    </Form>
  );
}

export function KindCard({ kind, isAdmin, onChanged }: { kind: ProfessionalKind; isAdmin: boolean; onChanged: () => void }) {
  const current = rateOn(kind.rates, today());
  return (
    <section className="card compact-card settings-kind">
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

export function AddKindForm({ onAdded }: { onAdded: () => void }) {
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
    <Form className="compact-form card compact-card" onSubmit={(event) => void submit(event)}>
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
        <Button type="submit" kind="secondary" disabled={saving || !displayName.trim()}>
          {saving ? 'Adding…' : 'Add kind'}
        </Button>
      </div>
    </Form>
  );
}
