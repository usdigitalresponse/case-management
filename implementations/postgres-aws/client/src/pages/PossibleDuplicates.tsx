// People who may have been added more than once. Any staff member flags a
// pair or marks them as different people; an administrator merges them
// (./MergePeople.tsx) and may undo a merge here.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  apiErrorMessage,
  reviewPossibleDuplicate,
  searchPeople,
  undoPersonMerge,
  type DuplicatePerson,
  type DuplicateReason,
  type PersonRecord,
  type PossibleDuplicate,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { personMerges, possibleDuplicates } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { TypeAheadPicker } from '../components/TypeAheadPicker';
import { ConfirmButton } from '../components/ConfirmButton';
import { Button, buttonClass } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Notice, type SaveMessage } from '../components/ui/Notice';
import { Tag } from '../components/ui/Tag';
import { formatDate, formatDateTime } from '../formatDateTime';
import { mergePath, personPath } from '../staffPaths';

const REASONS: Record<DuplicateReason, string> = {
  same_email: 'Same email',
  same_name: 'Same name',
  same_birth_date_and_family_name: 'Same date of birth and last name',
  flagged: 'Flagged by staff',
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

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

// The record with more on it is offered as the one to keep.
function keepFirst([a, b]: PossibleDuplicate['people']): [DuplicatePerson, DuplicatePerson] {
  const weight = (person: DuplicatePerson) => person.invoiceCount + person.caseCount + (person.provider?.signInEmail ? 1 : 0);
  return weight(b) > weight(a) ? [b, a] : [a, b];
}

export default function PossibleDuplicates() {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const { data: pairs, error } = useResource(possibleDuplicates, { resetKey: version });
  const { data: merges, error: mergesError } = useResource(personMerges, { resetKey: version });
  const [searchParams, setSearchParams] = useSearchParams();
  const justMerged = searchParams.get('merged');
  const [flagging, setFlagging] = useState(false);
  const [dismissing, setDismissing] = useState<PossibleDuplicate | null>(null);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [undoing, setUndoing] = useState(false);

  if (error || mergesError || !pairs || !merges) {
    return <LoadState error={error ?? mergesError} what="possible duplicates" />;
  }

  async function undo(personMergeId: string) {
    setUndoing(true);
    setMessage(null);
    try {
      const { leftAsIs } = await undoPersonMerge(personMergeId);
      setMessage({
        tone: 'success',
        text: leftAsIs > 0 ? `Merge undone. ${plural(leftAsIs, 'record')} changed since the merge stayed as they are.` : 'Merge undone.',
      });
      setSearchParams({}, { replace: true });
      setVersion((value) => value + 1);
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'The merge could not be undone.') });
    } finally {
      setUndoing(false);
    }
  }

  const merged = justMerged ? merges.find((merge) => merge.personMergeId === justMerged && !merge.undoneAt) : undefined;

  return (
    <div>
      <PageHeader
        list
        title="Possible duplicates"
        description="People who may have been added more than once, found by matching names, emails and dates of birth, or flagged by staff. Anyone on staff can flag a pair or mark them as different people; an administrator merges them."
        actions={
          <Button kind="secondary" onClick={() => setFlagging(true)}>
            Flag two people
          </Button>
        }
      />
      {merged && (
        <Notice
          tone="success"
          action={
            user?.isAdmin && (
              <Button kind="secondary" disabled={undoing} onClick={() => void undo(merged.personMergeId)}>
                Undo
              </Button>
            )
          }
        >
          Merged {merged.retired.displayName} into {merged.kept.displayName}.
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {pairs.length === 0 ? (
        <p className="empty-note">No possible duplicates right now.</p>
      ) : (
        <ul className="duplicate-list">
          {pairs.map((pair) => {
            const [kept, retired] = keepFirst(pair.people);
            return (
              <li key={`${kept.personId}|${retired.personId}`} className="card duplicate-pair">
                <div className="duplicate-pair__reasons">
                  {pair.reasons.map((reason) => (
                    <Tag key={reason} tone={reason === 'flagged' ? 'warning' : 'info'}>
                      {REASONS[reason]}
                    </Tag>
                  ))}
                  {pair.flagged && (
                    <span className="cell-note">
                      Flagged by {pair.flagged.byDisplayName} {formatDateTime(pair.flagged.at)}
                      {pair.flagged.note && `: “${pair.flagged.note}”`}
                    </span>
                  )}
                </div>
                <div className="duplicate-pair__people">
                  <DuplicatePersonDetails person={kept} />
                  <DuplicatePersonDetails person={retired} />
                </div>
                <div className="duplicate-pair__actions">
                  <Link className={buttonClass('primary')} to={mergePath(kept.personId, retired.personId)}>
                    {user?.isAdmin ? 'Review a merge' : 'See what a merge would do'}
                  </Link>
                  <Button kind="secondary" onClick={() => setDismissing(pair)}>
                    Not the same person
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Recent merges</h2>
      <RecordTable
        rows={merges}
        rowKey={(merge) => merge.personMergeId}
        emptyMessage="No one has been merged yet."
        columns={[
          { header: 'Merged', rowHeader: true, render: (merge) => merge.retired.displayName },
          { header: 'Into', render: (merge) => merge.kept.displayName },
          { header: 'Records moved', align: 'right', render: (merge) => merge.changeCount },
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
                    onConfirm={() => void undo(merge.personMergeId)}
                  />
                )
              ),
          },
        ]}
      />

      {flagging && (
        <FlagDialog
          onClose={() => setFlagging(false)}
          onFlagged={() => {
            setFlagging(false);
            setMessage({ tone: 'success', text: 'Flagged. They are listed here until someone merges them or marks them as different people.' });
            setVersion((value) => value + 1);
          }}
        />
      )}
      {dismissing && (
        <NotDuplicateDialog
          pair={dismissing}
          onClose={() => setDismissing(null)}
          onDone={() => {
            setDismissing(null);
            setMessage({ tone: 'success', text: `${dismissing.people[0].displayName} and ${dismissing.people[1].displayName} are recorded as different people.` });
            setVersion((value) => value + 1);
          }}
        />
      )}
    </div>
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
          searchPeople(query).then((result) =>
            result.people.map((person) => ({
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

function FlagDialog({ onClose, onFlagged }: { onClose: () => void; onFlagged: () => void }) {
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
      <p>They are listed here for an administrator to merge, or for anyone to mark as different people.</p>
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

function NotDuplicateDialog({ pair, onClose, onDone }: { pair: PossibleDuplicate; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [a, b] = pair.people;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await reviewPossibleDuplicate({ personIds: [a.personId, b.personId], outcome: 'not_duplicate', note });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'This could not be saved.'));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Not the same person?" onClose={onClose}>
      <p>
        {a.displayName} and {b.displayName} will no longer be listed as possible duplicates. Anyone can flag them again later.
      </p>
      <label className="usa-label" htmlFor="not-duplicate-note">
        How you know (optional)
      </label>
      <textarea id="not-duplicate-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="dialog__actions">
        <Button kind="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'They are different people'}
        </Button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
