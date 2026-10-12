import { useState, type FormEvent } from 'react';
import { Alert, Button, Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import {
  addKindRate,
  apiErrorMessage,
  createProfessionalKind,
  listProfessionalKinds,
  rateOn,
  type ProfessionalKind,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

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
      {error && <Alert type="error" slim>{error}</Alert>}
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
        <Button type="submit" disabled={saving || !(Number(hourlyRate) > 0) || !effectiveFrom}>
          {saving ? 'Saving…' : 'Add rate'}
        </Button>
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
      {error && <Alert type="error" slim>{error}</Alert>}
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
        <Button type="submit" disabled={saving || !displayName.trim()}>
          {saving ? 'Adding…' : 'Add kind'}
        </Button>
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
      <PageHeading
        eyebrow="Administration"
        title="Rates"
        description="Time is invoiced at the hourly rate for each professional's kind on the date of the work. Give each vendor a kind on the Vendors page."
      />
      {!isAdmin && <Alert type="info" slim>Only administrators can change rates.</Alert>}
      {Boolean(error) && <Alert type="error">Failed to load rates.</Alert>}
      {data && data.length === 0 && <p>No kinds of professional yet.</p>}
      {data?.map((kind) => <KindCard key={kind.professionalKindId} kind={kind} isAdmin={isAdmin} onChanged={refresh} />)}
      {isAdmin && <AddKindForm onAdded={refresh} />}
    </div>
  );
}
