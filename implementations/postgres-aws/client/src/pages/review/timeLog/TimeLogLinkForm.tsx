import { useState } from 'react';
import { apiErrorMessage, linkTimeLogEntries, type TimeLogCheck, type TimeLogEntryCheck } from '../../../api/client';
import { formatDate } from '../../../formatDateTime';
import { Button } from '../../../components/ui/Button';
import { type LineCheck, entryLabel, hours } from './timeLogText';

// Under a line: likely entries first, ticked when there's no choice to make.
export function TimeLogLinkForm({
  invoiceId,
  line,
  check,
  log,
  onSaved,
  onCancel,
}: {
  invoiceId: string;
  line: { invoiceLineId: string; serviceDate: string | null; quantity: string | null };
  check: LineCheck;
  log: TimeLogCheck;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const related = new Set(check.entryKeys);
  const usable = log.entries.filter((entry) => entry.use !== 'unreadable' && (entry.use !== 'outside_period' || related.has(entry.key)));
  const rank = (entry: TimeLogEntryCheck) => (related.has(entry.key) ? 0 : entry.date === line.serviceDate ? 1 : 2);
  const sorted = [...usable].sort((a, b) => rank(a) - rank(b) || (a.date ?? '').localeCompare(b.date ?? ''));
  const [picked, setPicked] = useState<string[]>(
    check.status === 'linked' || check.status === 'combined' || check.status === 'date_differs' ? check.entryKeys : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = picked.reduce((sum, key) => sum + (log.entries.find((entry) => entry.key === key)?.hours ?? 0), 0);
  const billed = Number(line.quantity ?? 0);

  async function save(keys: string[]) {
    setSaving(true);
    setError(null);
    try {
      await linkTimeLogEntries(invoiceId, line.invoiceLineId, keys);
      onSaved(keys.length === 0 ? 'Link removed.' : 'Log entries linked.');
    } catch (err) {
      setError(apiErrorMessage(err, 'That did not save. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="time-log-link"
      onSubmit={(event) => {
        event.preventDefault();
        void save(picked);
      }}
    >
      <h3>Which log entries support this line?</h3>
      <p className="cell-note">
        Billed {hours(billed)} on {formatDate(line.serviceDate)}. An entry linked here moves from any other line.
      </p>
      <div className="time-log-link__list">
        {sorted.map((entry) => (
          <label key={entry.key} className="checkbox-row">
            <input
              type="checkbox"
              checked={picked.includes(entry.key)}
              onChange={(event) => setPicked(event.target.checked ? [...picked, entry.key] : picked.filter((key) => key !== entry.key))}
            />
            <span>
              {formatDate(entry.date)}, {hours(entry.hours ?? 0)}, {entry.worker || 'no name'}
              {entry.details ? `: ${entry.details}` : ''}{' '}
              <span className="cell-note">
                {entryLabel(entry)}
                {entry.use === 'matched' || entry.use === 'linked' ? ', on another line' : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
      {picked.length > 0 && (
        <p className={Math.round(total * 100) === Math.round(billed * 100) ? 'cell-note' : 'line-rate-differs'}>
          Linked entries add up to {hours(total)}
          {Math.round(total * 100) === Math.round(billed * 100) ? ', as billed.' : `, not the ${hours(billed)} billed. It stays flagged.`}
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="button-row">
        <Button type="submit" kind="primary" disabled={saving || picked.length === 0}>
          Link {picked.length === 1 ? 'this entry' : `${picked.length || ''} entries`}
        </Button>
        {check.status === 'linked' && (
          <button type="button" className="link-button" disabled={saving} onClick={() => void save([])}>
            Remove the link
          </button>
        )}
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
