import { useState } from 'react';
import { apiErrorMessage, NOT_A_PERSON, removeTimeLog, setTimeLogColumns, setTimeLogWorker, type TimeLogCheck, type TimeLogEntryCheck } from '../../../api/client';
import { formatDate, formatPeriod } from '../../../formatDateTime';
import { Notice } from '../../../components/ui/Notice';
import { Button } from '../../../components/ui/Button';
import { Tag } from '../../../components/ui/Tag';
import { type LogPerson, entryLabel, hours } from './timeLogText';
import { ColumnChooser, TimeLogUpload, columnsUsed } from './TimeLogUpload';

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
