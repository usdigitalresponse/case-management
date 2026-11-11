import { useState, type FormEvent } from 'react';
import { Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import { addMileageRate, apiErrorMessage, mileageRateOn } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { mileageRates } from '../../resources';
import { RecordTable } from '../../components/RecordTable';
import { formatDate } from '../../formatDateTime';
import { formatRate } from '../../formatMoney';
import { Notice } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import { today } from './today';

// Mileage is priced at the rate per mile in force on the trip's date.
export function MileageRates({ isAdmin }: { isAdmin: boolean }) {
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
    <section className="card compact-card settings-kind">
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
            <Button type="submit" kind="secondary" disabled={saving || !(Number(ratePerMile) > 0) || !effectiveFrom}>
              {saving ? 'Saving…' : 'Add rate'}
            </Button>
          </div>
        </Form>
      )}
    </section>
  );
}
