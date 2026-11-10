// Default and county thresholds, and the kinds they apply to (model/rules.yaml apply_preauthorization_limit).
import { useState, type FormEvent } from 'react';
import { addThreshold, apiErrorMessage, getThresholdSettings, setKindThresholdApplies } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { CountyPicker } from './CountyPicker';
import type { CountyValue } from '../counties';
import { Notice } from './Notice';
import { RecordTable } from './RecordTable';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PreauthorizationThresholds({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => getThresholdSettings(), [version]);
  const refresh = () => setVersion((v) => v + 1);
  const [countyValue, setCountyValue] = useState<CountyValue | null>(null);
  const [amount, setAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent, removeCounty = false) {
    event.preventDefault();
    if (countyValue && !countyValue.countyId) {
      setSaveError('Choose a county from the list.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await addThreshold({ countyId: countyValue?.countyId ?? null, amount: removeCounty ? null : Number(amount), effectiveFrom });
      setAmount('');
      setCountyValue(null);
      refresh();
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'The threshold could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(kindId: string, applies: boolean) {
    setSaveError(null);
    try {
      await setKindThresholdApplies(kindId, applies);
      refresh();
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'Could not change the kind.'));
    }
  }

  if (error) return <Notice tone="danger">Failed to load thresholds.</Notice>;
  if (!data) return null;
  return (
    <div className="settings-columns settings-columns--even">
      <section className="compact-card">
        <h3>In force today</h3>
        <RecordTable
          label="Thresholds in force"
          rows={data.current}
          rowKey={(row) => row.countyId ?? 'default'}
          emptyMessage="No threshold set. Only approved pre-authorizations are tracked."
          columns={[
            { header: 'For', rowHeader: true, render: (row) => (row.countyId ? row.countyName : 'All other counties') },
            { header: 'Threshold', render: (row) => <span className="amount">{row.amount ? formatMoney(row.amount) : '—'}</span> },
            { header: 'Since', render: (row) => formatDate(row.effectiveFrom) },
          ]}
        />
        {isAdmin && (
          <form className="compact-form" onSubmit={(event) => void save(event)}>
            {saveError && <Notice tone="danger">{saveError}</Notice>}
            <CountyPicker
              id="threshold-county"
              label="County or setting (leave empty for the default)"
              value={countyValue}
              onChange={setCountyValue}
            />
            <div className="inline-fields rate-fields">
              <div className="usa-form-group">
                <label className="usa-label" htmlFor="threshold-amount">Threshold ($)</label>
                <input id="threshold-amount" className="usa-input" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
              <div className="usa-form-group">
                <label className="usa-label" htmlFor="threshold-from">Applies from</label>
                <input id="threshold-from" className="usa-input" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
              </div>
              <button type="submit" className="btn btn--outline" disabled={saving || !(Number(amount) > 0) || !effectiveFrom}>
                Add threshold
              </button>
              {countyValue?.countyId && (
                <button type="button" className="link-button" disabled={saving} onClick={(event) => void save(event, true)}>
                  Use the default for this county
                </button>
              )}
            </div>
          </form>
        )}
      </section>
      <section className="compact-card">
        <h3>Who thresholds apply to</h3>
        <p className="compact-hint">Not to an appointed attorney's own fees.</p>
        {data.kinds.length === 0 && <p className="muted">No kinds of professional yet.</p>}
        {data.kinds.map((kind) => (
          <label key={kind.professionalKindId} className="checkbox-row">
            <input
              type="checkbox"
              checked={kind.thresholdApplies}
              disabled={!isAdmin}
              onChange={(event) => void toggle(kind.professionalKindId, event.target.checked)}
            />
            <span>{kind.displayName}</span>
          </label>
        ))}
        <details>
          <summary>Earlier thresholds</summary>
          <RecordTable
            label="Every threshold added"
            rows={data.history}
            rowKey={(row) => `${row.countyId}-${row.effectiveFrom}-${row.recordedAt}`}
            columns={[
              { header: 'For', render: (row) => row.countyName ?? 'Default' },
              { header: 'Threshold', render: (row) => (row.amount ? formatMoney(row.amount) : 'Back to the default') },
              { header: 'From', render: (row) => formatDate(row.effectiveFrom) },
            ]}
          />
        </details>
      </section>
    </div>
  );
}
