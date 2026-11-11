import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  apiErrorMessage,
  linkTimeLogEntries,
  NOT_A_PERSON,
  removeTimeLog,
  setTimeLogColumns,
  setTimeLogWorker,
  uploadTimeLog,
  type TimeLogCheck,
  type TimeLogColumns,
  type TimeLogEntryCheck,
} from '../api/client';
import { formatDate, formatPeriod } from '../formatDateTime';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { Notice } from './ui/Notice';
import { Button, buttonClass } from './ui/Button';
import { SegmentedChoice } from './ui/SegmentedChoice';
import { Tag } from './ui/Tag';

// Checking time lines against a case time log (model/rules.yaml check_lines_against_time_log).

export interface LogPerson {
  professionalId: string;
  displayName: string;
}

type LineCheck = TimeLogCheck['lines'][number];

const hours = (value: number) => `${Number(value.toFixed(2))} h`;
const entryLabel = (entry: TimeLogEntryCheck) => entry.entryId ?? `row ${entry.key.slice(1)}`;

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
function ColumnChooser({
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
function columnsUsed(headers: string[], columns: TimeLogColumns): string {
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

// The overall result, names to confirm, and logged time that wasn't billed.
export function TimeLogSummary({
  invoiceId,
  log,
  people,
  canChange,
  logShown,
  onShowLog,
  onChanged,
}: {
  invoiceId: string;
  log: TimeLogCheck;
  people: LogPerson[];
  canChange: boolean;
  logShown: boolean;
  onShowLog: (shown: boolean) => void;
  onChanged: (message?: string) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const [choosingColumns, setChoosingColumns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = log.lines.filter((line) => line.status !== 'not_checked');
  const flagged = checked.filter((line) => line.flagged);
  const count = (use: TimeLogEntryCheck['use']) => log.entries.filter((entry) => entry.use === use).length;
  const unbilled = log.entries.filter((entry) => entry.use === 'unbilled');
  const inPeriod = log.entries.filter((entry) => entry.use !== 'outside_period' && entry.use !== 'unreadable');
  const nameOf = (professionalId: string | null) => people.find((person) => person.professionalId === professionalId)?.displayName ?? 'Someone';
  const differingDays = log.dailyTotals.filter((total) => Math.round(total.billed * 100) !== Math.round(total.logged * 100));

  async function act(action: () => Promise<unknown>, message?: string): Promise<boolean> {
    setError(null);
    try {
      await action();
      onChanged(message);
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, 'That did not save. Try again.'));
      return false;
    }
  }

  return (
    <section className="card time-log-summary" aria-labelledby="time-log-heading">
      <div className="time-log-summary__head">
        <div>
          <h2 id="time-log-heading">Checked against a time log</h2>
          <p className="cell-note">
            {log.fileName}. Kept only until you finish the review.
          </p>
        </div>
        <div className="link-row">
          <Button type="button" kind="secondary" aria-pressed={logShown} onClick={() => onShowLog(!logShown)}>
            {logShown ? 'Hide the log' : 'Show the log'}
          </Button>
          {canChange && !replacing && (
            <>
              <button type="button" className="link-button" onClick={() => setReplacing(true)}>
                Upload another
              </button>
              <button type="button" className="link-button" onClick={() => void act(() => removeTimeLog(invoiceId), 'Time log removed.')}>
                Remove it
              </button>
            </>
          )}
        </div>
      </div>
      {replacing && (
        <TimeLogUpload
          invoiceId={invoiceId}
          replacing
          onCancel={() => setReplacing(false)}
          onUploaded={() => {
            setReplacing(false);
            onChanged('Time log replaced. Names you confirmed and entries you linked were cleared.');
          }}
        />
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {choosingColumns ? (
        <ColumnChooser
          headers={log.headers}
          initial={log.columns}
          intro="Choose which column holds what. The log is compared again; entries you linked stay linked."
          saving={false}
          onCancel={() => setChoosingColumns(false)}
          onChoose={(columns) =>
            void act(() => setTimeLogColumns(invoiceId, columns), 'Columns changed.').then((done) => done && setChoosingColumns(false))
          }
        />
      ) : (
        <p className="cell-note time-log-columns-used">
          Read {columnsUsed(log.headers, log.columns)}.{' '}
          {canChange && (
            <button type="button" className="link-button" onClick={() => setChoosingColumns(true)}>
              Change columns
            </button>
          )}
        </p>
      )}

      {inPeriod.length === 0 ? (
        <Notice tone="warning" heading="No log entries fall in the billing period.">
          {log.period ? `None of its ${log.entries.length} entries are from ${formatPeriod(log.period.start, log.period.end)}. ` : ''}
          Check it's this case's time log.
        </Notice>
      ) : (
        <p className="time-log-summary__counts">
          <strong>
            {checked.length - flagged.length} of {checked.length} time {checked.length === 1 ? 'line matches' : 'lines match'}
          </strong>
          {flagged.length > 0 && <Tag tone="warning">{flagged.length} flagged</Tag>}
          <span className="cell-note">
            {inPeriod.length} log {inPeriod.length === 1 ? 'entry' : 'entries'} in the billing period
            {count('outside_period') > 0 && `, ${count('outside_period')} outside it`}
            {count('unreadable') > 0 && `, ${count('unreadable')} without a readable date or hours`}.
          </span>
        </p>
      )}
      <p className="cell-note">
        {log.blocksApproval
          ? 'Approving the billed hours of a flagged line asks why. Sign-off sees your reason; the submitter doesn’t.'
          : "Flags are for checking. They don't stop you approving a line."}
      </p>

      <WorkerMatches invoiceId={invoiceId} log={log} people={people} canChange={canChange} act={act} />

      {unbilled.length > 0 && (
        <details className="time-log-details">
          <summary>
            In the log but not billed: {unbilled.length} {unbilled.length === 1 ? 'entry' : 'entries'},{' '}
            {hours(unbilled.reduce((sum, entry) => sum + (entry.hours ?? 0), 0))}
          </summary>
          <ul>
            {unbilled.map((entry) => (
              <li key={entry.key}>
                {formatDate(entry.date)}, {hours(entry.hours ?? 0)}, {entry.worker || 'no name'}
                {entry.details ? `: ${entry.details}` : ''} ({entryLabel(entry)})
              </li>
            ))}
          </ul>
        </details>
      )}
      {differingDays.length > 0 && (
        <details className="time-log-details">
          <summary>
            Days where billed and logged hours differ: {differingDays.length}
          </summary>
          <table className="time-log-days">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Person</th>
                <th scope="col">Billed</th>
                <th scope="col">Logged</th>
              </tr>
            </thead>
            <tbody>
              {differingDays.map((total) => (
                <tr key={`${total.date}-${total.professionalId}`}>
                  <td>{formatDate(total.date)}</td>
                  <td>{nameOf(total.professionalId)}</td>
                  <td>{hours(total.billed)}</td>
                  <td>{hours(total.logged)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

// Names in the log that weren't an exact match: suggested, never assumed.
function WorkerMatches({
  invoiceId,
  log,
  people,
  canChange,
  act,
}: {
  invoiceId: string;
  log: TimeLogCheck;
  people: LogPerson[];
  canChange: boolean;
  act: (action: () => Promise<unknown>, message?: string) => Promise<boolean>;
}) {
  const workers = log.workers.filter((worker) => !worker.automatic);
  const [choices, setChoices] = useState<Record<string, string>>({});
  if (workers.length === 0) {
    return null;
  }
  const nameOf = (professionalId: string | null) => people.find((person) => person.professionalId === professionalId)?.displayName;
  const unconfirmed = workers.filter((worker) => !worker.professionalId && !worker.notAPerson);
  return (
    <div className="time-log-workers">
      <h3>Names in the log</h3>
      {unconfirmed.length > 0 && (
        <p className="cell-note">
          Entries under {unconfirmed.length === 1 ? 'this name aren’t' : 'these names aren’t'} matched to anyone on the invoice until
          you say who {unconfirmed.length === 1 ? 'it is' : 'they are'}.
        </p>
      )}
      <ul>
        {workers.map((worker) => {
          const chosen = choices[worker.name] ?? worker.suggestedProfessionalId ?? '';
          const label = worker.name || 'No name';
          return (
            <li key={worker.name}>
              <span>
                <strong>“{label}”</strong>{' '}
                <span className="cell-note">
                  {worker.entryCount} {worker.entryCount === 1 ? 'entry' : 'entries'}
                </span>
              </span>
              {worker.professionalId || worker.notAPerson ? (
                <span className="time-log-workers__set">
                  {worker.notAPerson ? 'Not a person' : `Is ${nameOf(worker.professionalId) ?? 'someone on the invoice'}`}
                  {canChange && (
                    <button type="button" className="link-button" onClick={() => void act(() => setTimeLogWorker(invoiceId, worker.name, null))}>
                      Change
                    </button>
                  )}
                </span>
              ) : canChange ? (
                <span className="time-log-workers__choose">
                  <label className="usa-sr-only" htmlFor={`worker-${worker.name}`}>
                    Who is “{label}”?
                  </label>
                  <select className="usa-select"
                    id={`worker-${worker.name}`}
                    value={chosen}
                    onChange={(event) => setChoices({ ...choices, [worker.name]: event.target.value })}
                  >
                    <option value="">Choose who this is</option>
                    {people.map((person) => (
                      <option key={person.professionalId} value={person.professionalId}>
                        {person.displayName}
                        {person.professionalId === worker.suggestedProfessionalId ? ' (suggested)' : ''}
                      </option>
                    ))}
                    <option value={NOT_A_PERSON}>Not a person (an office or shared account)</option>
                  </select>
                  <Button
                    type="button"
                    kind="secondary"
                    disabled={!chosen}
                    onClick={() => void act(() => setTimeLogWorker(invoiceId, worker.name, chosen))}
                  >
                    Confirm
                  </Button>
                </span>
              ) : (
                <span className="cell-note">Not matched</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STATUS_TEXT: Record<LineCheck['status'], string> = {
  matched: 'Matches the log',
  linked: 'Linked by you',
  hours_differ: 'Hours differ',
  several: 'More than one entry could match',
  combined: 'Split across entries',
  date_differs: 'Logged on another day',
  other_account: 'Only under another name',
  not_in_log: 'Not in the log',
  not_checked: 'Not checked',
};

// One line's result, in its own column.
export function TimeLogLineCell({
  check,
  log,
  canLink,
  onShow,
  onLink,
}: {
  check: LineCheck | undefined;
  log: TimeLogCheck;
  canLink: boolean;
  onShow: () => void;
  onLink: () => void;
}) {
  if (!check || check.status === 'not_checked') {
    return <span className="muted">Not time</span>;
  }
  const entries = check.entryKeys.flatMap((key) => log.entries.filter((entry) => entry.key === key));
  const detail = (() => {
    switch (check.status) {
      case 'matched':
        return entries[0] ? entryLabel(entries[0]) : null;
      case 'linked':
        return check.flagged ? `Log ${hours(check.loggedHours ?? 0)}` : entries.map(entryLabel).join(', ');
      case 'hours_differ':
        return `Log ${hours(check.loggedHours ?? 0)}`;
      case 'combined':
        return entries.map((entry) => hours(entry.hours ?? 0)).join(' + ');
      case 'date_differs':
        return entries[0] ? formatDate(entries[0].date) : null;
      case 'other_account':
        return entries[0] ? `“${entries[0].worker}”` : null;
      case 'several':
        return `${entries.length} entries`;
      default:
        return null;
    }
  })();
  return (
    <div className={`time-log-cell${check.flagged ? ' is-flagged' : ''}`}>
      <button type="button" className="link-button time-log-cell__status" onClick={onShow}>
        {check.flagged ? '⚠ ' : '✓ '}
        {STATUS_TEXT[check.status]}
      </button>
      {detail && <span className="cell-note">{detail}</span>}
      {canLink && (check.flagged || check.status === 'linked') && (
        <button type="button" className="link-button cell-note" onClick={onLink}>
          {check.status === 'linked' ? 'Change link' : 'Link entries'}
        </button>
      )}
    </div>
  );
}

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

const USE_TEXT: Record<TimeLogEntryCheck['use'], string> = {
  matched: 'Line',
  linked: 'Linked to line',
  suggested: 'Possible for line',
  unbilled: 'Not billed',
  outside_period: 'Outside the period',
  unreadable: 'No date or hours',
};

// Which of the file and the log is beside the lines.
export function SidePanelSwitch({ logShown, onShowLog }: { logShown: boolean; onShowLog: (shown: boolean) => void }) {
  return (
    <SegmentedChoice
      label="Beside the lines"
      className="segmented--above"
      options={[
        { value: 'file', label: 'The file' },
        { value: 'log', label: 'Time log' },
      ]}
      value={logShown ? 'log' : 'file'}
      onChange={(shown) => onShowLog(shown === 'log')}
    />
  );
}

// The log beside the lines, with the entries a chosen line is about highlighted.
export function TimeLogEntries({
  log,
  focusKeys,
  lineNumber,
}: {
  log: TimeLogCheck;
  // A new array on every click, so the same line scrolls back to it.
  focusKeys: string[] | undefined;
  lineNumber: (invoiceLineId: string) => number | undefined;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = focusKeys?.[0];
    if (first) panel.current?.querySelector(`[data-entry="${first}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusKeys]);
  const focused = new Set(focusKeys ?? []);
  return (
    <aside className="card original-document time-log-entries" aria-label="Time log">
      <div className="original-document__bar">
        <div className="original-document__name">
          <h2>Time log, from your {EXTERNAL_SYSTEM_NAME}</h2>
          <span>{log.fileName}</span>
        </div>
      </div>
      <div className="original-document__frame time-log-entries__frame" ref={panel}>
        <table className="time-log-entries__table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Hours</th>
              <th scope="col">Who</th>
              <th scope="col">Here</th>
            </tr>
          </thead>
          <tbody>
            {log.entries.map((entry) => {
              const number = entry.invoiceLineId ? lineNumber(entry.invoiceLineId) : undefined;
              return (
                <tr
                  key={entry.key}
                  data-entry={entry.key}
                  className={[focused.has(entry.key) ? 'is-focused' : '', entry.use === 'outside_period' ? 'is-outside' : ''].join(' ').trim() || undefined}
                >
                  <td>
                    {formatDate(entry.date)}
                    <span className="cell-note">{entryLabel(entry)}</span>
                  </td>
                  <td>
                    {entry.hours === null ? '—' : hours(entry.hours)}
                    {entry.clockHours !== null && (
                      <span className="cell-note line-rate-differs">
                        {entry.start}–{entry.stop} is {hours(entry.clockHours)}
                      </span>
                    )}
                  </td>
                  <td>
                    {entry.worker || '—'}
                    {entry.details && <span className="cell-note">{entry.details}</span>}
                  </td>
                  <td>
                    {USE_TEXT[entry.use]}
                    {number !== undefined && ` ${number}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
