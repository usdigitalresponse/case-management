// While an invoice's lines are still being entered: who is entering them and
// when they last changed, for them and for anyone else looking at it.
import { formatDateTime } from '../formatDateTime';
import { Tag } from './ui/Tag';

export function EntryBadge({
  enteringName,
  own,
  changedByName,
  changedAt,
}: {
  enteringName: string | null;
  // The viewer is the one entering it.
  own: boolean;
  changedByName: string | null;
  changedAt: string | null;
}) {
  const by = own ? 'you' : (enteringName ?? 'someone');
  // After a takeover the last change may be someone else's.
  const changer = changedByName && changedByName !== enteringName ? ` by ${changedByName}` : '';
  return (
    <span className="entry-badge" role="status">
      <Tag tone="info">Being entered by {by}</Tag>
      {changedAt && (
        <span className="cell-note">
          {own ? 'Last saved' : 'Last change'} {formatDateTime(changedAt)}
          {changer}
        </span>
      )}
    </span>
  );
}
