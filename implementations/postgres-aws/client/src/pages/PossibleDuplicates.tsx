// People and cases that may have been recorded more than once. Any staff
// member flags a pair or marks it as different; an administrator merges
// people (./MergePeople.tsx) and may undo a merge here. Cases are never
// merged here (../components/DuplicateCases.tsx).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  apiErrorMessage,
  reviewPossibleDuplicate,
  searchPeople,
  undoPersonMerges,
  type DuplicatePair,
  type DuplicatePerson,
  type DuplicateReason,
  type PersonRecord,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { personMerges, possibleDuplicates } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { TypeAheadPicker } from '../components/TypeAheadPicker';
import { ConfirmButton } from '../components/ConfirmButton';
import { DuplicateCases } from '../components/DuplicateCases';
import { NotDuplicateDialog, plural } from '../components/NotDuplicateDialog';
import { Button, buttonClass } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Notice, type SaveMessage } from '../components/ui/Notice';
import { FilterTag, Tag } from '../components/ui/Tag';
import { formatDate, formatDateTime } from '../formatDateTime';
import { mergePath, personPath } from '../staffPaths';

const REASONS: Record<DuplicateReason, string> = {
  same_email: 'Same email',
  same_name: 'Same name',
  same_birth_date_and_family_name: 'Same date of birth and last name',
  flagged: 'Flagged by staff',
};

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

// The record with the most on it is offered as the one to keep.
function keepFirst(people: DuplicatePerson[]): DuplicatePerson[] {
  const weight = (person: DuplicatePerson) => person.invoiceCount + person.caseCount + (person.provider?.signInEmail ? 1 : 0);
  return [...people].sort((a, b) => weight(b) - weight(a));
}

const TABS = ['people', 'cases'] as const;

export default function PossibleDuplicates() {
  const [show, setShow] = useSearchParamState<(typeof TABS)[number]>('show', 'people', [...TABS]);
  return (
    <div>
      <PageHeader
        list
        title="Possible duplicates"
        description="People and cases that may have been added more than once. Anyone on staff can flag them or mark them as different; an administrator merges people."
      />
      <div className="tag-filters page-tabs" role="tablist" aria-label="Show">
        <FilterTag role="tab" aria-selected={show === 'people'} aria-pressed={show === 'people'} onClick={() => setShow('people')}>
          People
        </FilterTag>
        <FilterTag role="tab" aria-selected={show === 'cases'} aria-pressed={show === 'cases'} onClick={() => setShow('cases')}>
          Cases
        </FilterTag>
      </div>
      {show === 'cases' ? <DuplicateCases /> : <DuplicatePeople />}
    </div>
  );
}

function DuplicatePeople() {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const { data: groups, error } = useResource(possibleDuplicates, { resetKey: version });
  const { data: merges, error: mergesError } = useResource(personMerges, { resetKey: version });
  const [searchParams, setSearchParams] = useSearchParams();
  const justMerged = searchParams.get('merged')?.split(',') ?? [];
  const [flagging, setFlagging] = useState(false);
  const [dismissing, setDismissing] = useState<{ pair: DuplicatePair; labels: Map<string, string> } | null>(null);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [undoing, setUndoing] = useState(false);

  if (error || mergesError || !groups || !merges) {
    return <LoadState error={error ?? mergesError} what="possible duplicates" />;
  }

  async function undo(personMergeIds: string[]) {
    setUndoing(true);
    setMessage(null);
    try {
      const { leftAsIs } = await undoPersonMerges(personMergeIds);
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

  // In the order they were merged, for undoing last first.
  const merged = justMerged.flatMap((id) => merges.filter((merge) => merge.personMergeId === id && !merge.undoneAt));

  return (
    <>
      <div className="section-heading-row">
        <p className="compact-hint">Found by matching names, emails and dates of birth, or flagged by staff. Each card is one person who may have several records.</p>
        <Button kind="secondary" onClick={() => setFlagging(true)}>
          Flag two people
        </Button>
      </div>
      {merged.length > 0 && (
        <Notice
          tone="success"
          action={
            user?.isAdmin && (
              <Button kind="secondary" disabled={undoing} onClick={() => void undo(merged.map((merge) => merge.personMergeId))}>
                Undo
              </Button>
            )
          }
        >
          Merged {plural(merged.length, 'record')} into {merged[0]!.kept.displayName}.
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {groups.length === 0 ? (
        <p className="empty-note">No possible duplicates right now.</p>
      ) : (
        <ul className="duplicate-list">
          {groups.map((group) => {
            const people = keepFirst(group.people);
            const labels = personLabels(people);
            return (
              <li key={people.map((person) => person.personId).join('|')} className="card duplicate-pair">
                <ul className="duplicate-pair__links">
                  {group.pairs.map((pair) => (
                    <li key={pair.personIds.join('|')}>
                      <span>
                        {labels.get(pair.personIds[0])} and {labels.get(pair.personIds[1])}:
                      </span>
                      {pair.reasons.map((reason) => (
                        <Tag key={reason} tone={reason === 'flagged' ? 'warning' : 'info'}>
                          {REASONS[reason]}
                        </Tag>
                      ))}
                      {pair.flagged && (
                        <span className="cell-note">
                          by {pair.flagged.byDisplayName} {formatDateTime(pair.flagged.at)}
                          {pair.flagged.note && `: “${pair.flagged.note}”`}
                        </span>
                      )}
                      <button type="button" className="link-button" onClick={() => setDismissing({ pair, labels })}>
                        Not the same person
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="duplicate-pair__people">
                  {people.map((person) => (
                    <DuplicatePersonDetails key={person.personId} person={person} />
                  ))}
                </div>
                <div className="duplicate-pair__actions">
                  <Link className={buttonClass('primary')} to={mergePath(people[0]!.personId, people.slice(1).map((person) => person.personId))}>
                    {user?.isAdmin ? 'Review a merge' : 'See what a merge would do'}
                  </Link>
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
                    onConfirm={() => void undo([merge.personMergeId])}
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
          what="person"
          names={[dismissing.labels.get(dismissing.pair.personIds[0])!, dismissing.labels.get(dismissing.pair.personIds[1])!]}
          save={(note) => reviewPossibleDuplicate({ personIds: dismissing.pair.personIds, outcome: 'not_duplicate', note })}
          onClose={() => setDismissing(null)}
          onDone={(text) => {
            setDismissing(null);
            setMessage({ tone: 'success', text });
            setVersion((value) => value + 1);
          }}
        />
      )}
    </>
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
