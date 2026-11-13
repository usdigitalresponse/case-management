// Parts for people who may have been recorded more than once (Settings › Merge
// duplicates, ./MergeDuplicates.tsx): any staff member flags a pair; an
// administrator merges them (../pages/MergePeople.tsx) and may undo a merge.
import { useState } from 'react';
import { Link } from 'react-router';
import { apiErrorMessage, reviewPossibleDuplicate, searchPeople, type DuplicatePerson, type PersonRecord } from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { personMerges } from '../resources';
import { LoadState } from './LoadState';
import { RecordTable } from './RecordTable';
import { TypeAheadPicker } from './TypeAheadPicker';
import { ConfirmButton } from './ConfirmButton';
import { plural } from './NotDuplicateDialog';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Notice } from './ui/Notice';
import { Tag } from './ui/Tag';
import { formatDate, formatDateTime } from '../formatDateTime';
import { personPath } from '../staffPaths';

// Names, told apart by email where two match.
export function personLabels(people: DuplicatePerson[]): Map<string, string> {
  const shared = (name: string) => people.filter((person) => person.displayName === name).length > 1;
  const labels = people.map((person) =>
    shared(person.displayName) ? `${person.displayName} (${person.provider?.signInEmail ?? person.email ?? 'no email'})` : person.displayName,
  );
  return new Map(
    people.map((person, index) => [person.personId, labels.filter((label) => label === labels[index]).length > 1 ? `${labels[index]} #${index + 1}` : labels[index]!]),
  );
}

export function DuplicatePersonDetails({ person }: { person: DuplicatePerson }) {
  return (
    <div className="duplicate-person">
      <strong className="duplicate-person__name">
        {person.provider ? <Link to={personPath(person.provider.professionalId)}>{person.displayName}</Link> : person.displayName}
      </strong>
      <dl className="duplicate-person__facts">
        <dt>Email</dt>
        <dd>{person.email ?? '—'}</dd>
        {person.provider?.signInEmail && person.provider.signInEmail !== person.email && (
          <>
            <dt>Signs in as</dt>
            <dd>{person.provider.signInEmail}</dd>
          </>
        )}
        <dt>Date of birth</dt>
        <dd>{person.dateOfBirth ? formatDate(person.dateOfBirth) : '—'}</dd>
        <dt>Sends invoices</dt>
        <dd>{person.provider ? (person.provider.kind ?? 'Yes') + (person.provider.signInEmail ? ', signs in' : ', has not signed in') : 'No'}</dd>
        <dt>On record</dt>
        <dd>
          {plural(person.caseCount, 'case')}, {plural(person.invoiceCount, 'invoice')}
        </dd>
      </dl>
    </div>
  );
}

// Merges of people, newest first, each undone here by an administrator.
export function RecentMerges({ version, undoing, onUndo }: { version: number; undoing: boolean; onUndo: (personMergeIds: string[]) => void }) {
  const { user } = useAuth();
  const { data: merges, error } = useResource(personMerges, { resetKey: version });
  if (error || !merges) return <LoadState error={error} what="recent merges" />;
  return (
    <RecordTable
      label="Recent merges"
      rows={merges}
      rowKey={(merge) => merge.personMergeId}
      emptyMessage="No one has been merged yet."
      columns={[
        { header: 'Merged', rowHeader: true, render: (merge) => merge.retired.displayName },
        { header: 'Into', render: (merge) => merge.kept.displayName },
        {
          header: 'By',
          render: (merge) => (
            <>
              {merge.mergedBy}
              <span className="cell-note">{formatDateTime(merge.mergedAt)}</span>
              {merge.note && <span className="cell-note">{merge.note}</span>}
            </>
          ),
        },
        {
          header: 'Undo',
          hiddenHeader: true,
          render: (merge) =>
            merge.undoneAt ? (
              <Tag tone="neutral">Undone {formatDate(merge.undoneAt.slice(0, 10))}</Tag>
            ) : (
              user?.isAdmin && (
                <ConfirmButton
                  compact
                  label="Undo"
                  prompt={`Undo merging ${merge.retired.displayName} into ${merge.kept.displayName}? Everything it moved goes back, except anything changed since.`}
                  confirmLabel="Yes, undo"
                  disabled={undoing}
                  onConfirm={() => onUndo([merge.personMergeId])}
                />
              )
            ),
        },
      ]}
    />
  );
}

function PersonSearch({ id, label, onSelect }: { id: string; label: string; onSelect: (person: PersonRecord | undefined) => void }) {
  return (
    <div className="usa-form-group">
      <label className="usa-label" id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <TypeAheadPicker
        id={id}
        placeholder="Search by name or email"
        noResults="No people found."
        search={(query) =>
          searchPeople(query, null).then((result) =>
            result.items.map((person) => ({
              value: person.personId,
              label: person.email ? `${person.displayName} (${person.email})` : person.displayName,
              item: person,
            })),
          )
        }
        onSelect={onSelect}
      />
    </div>
  );
}

export function FlagPeopleDialog({ onClose, onFlagged }: { onClose: () => void; onFlagged: () => void }) {
  const [first, setFirst] = useState<PersonRecord>();
  const [second, setSecond] = useState<PersonRecord>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = first && second && first.personId !== second.personId;

  async function flag() {
    if (!first || !second) return;
    setSaving(true);
    setError(null);
    try {
      await reviewPossibleDuplicate({ personIds: [first.personId, second.personId], outcome: 'possible_duplicate', note });
      onFlagged();
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be flagged.'));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Flag two people as possibly the same" onClose={onClose} className="dialog--wide">
      <p>They are listed in Settings, under Merge duplicates, for an administrator to merge or for anyone to mark as different people.</p>
      <PersonSearch id="flag-first" label="One person" onSelect={setFirst} />
      <PersonSearch id="flag-second" label="The other" onSelect={setSecond} />
      {first && second && first.personId === second.personId && <p className="field-error">Choose two different people.</p>}
      <label className="usa-label" htmlFor="flag-note">
        Why they may be the same (optional)
      </label>
      <textarea id="flag-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="dialog__actions">
        <Button kind="primary" disabled={!ready || saving} onClick={() => void flag()}>
          {saving ? 'Flagging…' : 'Flag them'}
        </Button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
