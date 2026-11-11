import { useEffect, useRef } from 'react';
import { type TimeLogCheck, type TimeLogEntryCheck } from '../../../api/client';
import { formatDate } from '../../../formatDateTime';
import { EXTERNAL_SYSTEM_NAME } from '../../../externalSystem';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { entryLabel, hours } from './timeLogText';

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
