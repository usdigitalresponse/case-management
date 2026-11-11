import { useState, type FormEvent } from 'react';
import { Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import { addTimeCategoryRate, apiErrorMessage, categoryRateIn, type TimeCategory, type TimeCategoryBasis } from '../../api/client';
import { timeCategoryRateLabel } from '../../invoiceLines';
import { useResource } from '../../hooks/useResource';
import { timeCategoryRates } from '../../resources';
import { RecordTable } from '../../components/RecordTable';
import { formatDate } from '../../formatDateTime';
import { Notice } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import { today } from './today';

// How travel or waiting time is priced from a date: the hourly rate, a
// percent of it or one flat rate (model/rules.yaml apply_time_category_rates).
export function TimeCategoryRates({ category, isAdmin }: { category: TimeCategory; isAdmin: boolean }) {
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
    <section className="card compact-card settings-kind">
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
            <Button type="submit" kind="secondary" disabled={saving || (needsAmount && !(Number(amount) > 0)) || !effectiveFrom}>
              {saving ? 'Saving…' : 'Add setting'}
            </Button>
          </div>
        </Form>
      )}
    </section>
  );
}
