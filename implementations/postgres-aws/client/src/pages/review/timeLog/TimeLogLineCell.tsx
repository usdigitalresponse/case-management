import { type TimeLogCheck } from '../../../api/client';
import { formatDate } from '../../../formatDateTime';
import { type LineCheck, entryLabel, hours } from './timeLogText';

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
