import { useRef, useState, type FormEvent } from 'react';
import { apiErrorMessage, uploadTimeLog, type TimeLogColumns } from '../../../api/client';
import { Button, buttonClass } from '../../../components/ui/Button';

// The columns a reviewer can choose; time spent is chosen with its unit.
const CHOSEN_FIELDS = [
  { field: 'date', label: 'Date of the work', required: true },
  { field: 'worker', label: 'Who did the work', required: true },
  { field: 'details', label: 'Description', required: false },
  { field: 'entryId', label: 'Entry number', required: false },
  { field: 'start', label: 'Start time', required: false },
  { field: 'stop', label: 'Stop time', required: false },
] as const;

type ChosenField = (typeof CHOSEN_FIELDS)[number]['field'];

function ColumnSelect({ id, label, headers, value, onChange }: { id: string; label: string; headers: string[]; value: number | undefined; onChange: (value: number | undefined) => void }) {
  return (
    <label htmlFor={id}>
      {label}
      <select className="usa-select" id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}>
        <option value="">None</option>
        {headers.map((header, index) => (
          <option key={index} value={index}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

// Which column holds what, starting from `initial`.
export function ColumnChooser({
  headers,
  initial,
  intro,
  saving,
  onChoose,
  onCancel,
}: {
  headers: string[];
  initial: TimeLogColumns;
  intro: string;
  saving: boolean;
  onChoose: (columns: TimeLogColumns) => void;
  onCancel: () => void;
}) {
  const [columns, setColumns] = useState<Partial<Record<ChosenField, number>>>(() => {
    const { hours: _hours, minutes: _minutes, ...rest } = initial;
    return rest;
  });
  const [time, setTime] = useState<number | undefined>(initial.hours ?? initial.minutes);
  const [unit, setUnit] = useState<'hours' | 'minutes'>(initial.hours === undefined && initial.minutes !== undefined ? 'minutes' : 'hours');
  const missing = columns.date === undefined || columns.worker === undefined || time === undefined;

  return (
    <form
      className="time-log-columns"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onChoose({ ...columns, [unit]: time });
      }}
    >
      <p>{intro}</p>
      <div className="time-log-columns__grid">
        {CHOSEN_FIELDS.slice(0, 2).map(({ field, label }) => (
          <ColumnSelect key={field} id={`log-column-${field}`} label={label} headers={headers} value={columns[field]} onChange={(value) => setColumns({ ...columns, [field]: value })} />
        ))}
        <div className="time-log-columns__time">
          <ColumnSelect id="log-column-time" label="Time spent" headers={headers} value={time} onChange={setTime} />
          <span className="radio-choices" role="radiogroup" aria-label="Time spent is in">
            {(['hours', 'minutes'] as const).map((choice) => (
              <label key={choice}>
                <input type="radio" name="log-column-unit" checked={unit === choice} onChange={() => setUnit(choice)} />
                {choice === 'hours' ? 'Hours' : 'Minutes'}
              </label>
            ))}
          </span>
        </div>
        {CHOSEN_FIELDS.slice(2).map(({ field, label }) => (
          <ColumnSelect
            key={field}
            id={`log-column-${field}`}
            label={`${label} (optional)`}
            headers={headers}
            value={columns[field]}
            onChange={(value) => setColumns({ ...columns, [field]: value })}
          />
        ))}
      </div>
      <div className="button-row">
        <Button type="submit" kind="primary" disabled={saving || missing}>
          Use these columns
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
        {missing && <span className="cell-note">Choose the date, who did the work and the time spent.</span>}
      </div>
    </form>
  );
}

// "Date of Service" for Date, …: the columns in use, to check at a glance.
export function columnsUsed(headers: string[], columns: TimeLogColumns): string {
  const name = (index: number | undefined) => (index === undefined ? null : `“${headers[index] || `Column ${index + 1}`}”`);
  return [
    ['date', name(columns.date)],
    ['who', name(columns.worker)],
    [columns.hours !== undefined ? 'hours' : 'minutes', name(columns.hours ?? columns.minutes)],
    ['description', name(columns.details)],
    ['entry number', name(columns.entryId)],
    ['start', name(columns.start)],
    ['stop', name(columns.stop)],
  ]
    .filter(([, header]) => header)
    .map(([label, header]) => `${header} as ${label}`)
    .join(', ');
}

// Choosing a file uploads it; a log whose columns can't be found asks for them.
export function TimeLogUpload({
  invoiceId,
  replacing,
  onUploaded,
  onCancel,
}: {
  invoiceId: string;
  replacing: boolean;
  onUploaded: () => void;
  onCancel?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send(chosen: File, chosenColumns?: TimeLogColumns) {
    setSaving(true);
    setError(null);
    try {
      const result = await uploadTimeLog(invoiceId, chosen, chosenColumns);
      if (result.needsColumns) {
        setHeaders(result.headers);
        return;
      }
      setFile(null);
      setHeaders(null);
      onUploaded();
    } catch (err) {
      setError(apiErrorMessage(err, 'The time log could not be read. Try again.'));
    } finally {
      setSaving(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="time-log-upload">
      <label className={buttonClass('secondary', { className: 'time-log-upload__button' })}>
        {saving ? 'Reading…' : replacing ? 'Upload another time log' : 'Upload a time log'}
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="usa-sr-only"
          disabled={saving}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) {
              setFile(chosen);
              void send(chosen);
            }
          }}
        />
      </label>
      {onCancel && !headers && (
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {headers && file && (
        <ColumnChooser
          headers={headers}
          initial={{}}
          intro={`Which columns are which in ${file.name}? Its headers didn't say, so nothing is compared until you choose.`}
          saving={saving}
          onChoose={(columns) => void send(file, columns)}
          onCancel={() => {
            setHeaders(null);
            setFile(null);
            onCancel?.();
          }}
        />
      )}
    </div>
  );
}
