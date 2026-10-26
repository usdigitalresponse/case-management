import { useEffect, useState } from 'react';
import {
  apiErrorMessage,
  listReviewPeople,
  reassignReviewer,
  setSignOffApprovers,
  type AssignedPerson,
  type ReviewPerson,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { OrderedChoiceList } from './OrderedChoiceList';

// Staff who review or sign off, with how many invoices each has waiting.
// Loaded only once `enabled`, such as when a picker opens.
export function useReviewPeople(enabled = true): ReviewPerson[] | null {
  const { data, error } = useApiResource(
    () => (enabled ? listReviewPeople().then((result) => result.people) : Promise.resolve(null)),
    [enabled],
  );
  return data ?? (error ? [] : null);
}

// A dropdown of reviewers: a case's reviewer, or the default in Settings.
export function ReviewerSelect({
  id,
  people,
  value,
  emptyLabel,
  disabled,
  onChange,
}: {
  id: string;
  people: ReviewPerson[];
  value: string;
  // The choice for no one; omitted when someone must be chosen.
  emptyLabel?: string;
  disabled?: boolean;
  onChange: (userAccountId: string) => void;
}) {
  return (
    <select id={id} className="usa-select settings-role" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled={!emptyLabel}>{emptyLabel ?? 'Choose a reviewer'}</option>
      {people
        .filter((person) => person.reviewsLines)
        .map((person) => (
          <option key={person.userAccountId} value={person.userAccountId}>
            {person.displayName} ({person.waiting} waiting)
          </option>
        ))}
    </select>
  );
}

// The queue's Assign button for an invoice with no reviewer: pick someone
// and it is theirs.
export function AssignReviewer({ invoiceId, onAssigned }: { invoiceId: string; onAssigned: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const people = useReviewPeople(open);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="btn btn--outline btn--small" onClick={() => setOpen(true)}>
        Assign
      </button>
    );
  }
  return (
    <>
      <label className="usa-sr-only" htmlFor={`assign-${invoiceId}`}>Who reviews this invoice</label>
      <ReviewerSelect
        id={`assign-${invoiceId}`}
        people={people ?? []}
        value=""
        onChange={(userAccountId) => {
          setError(null);
          reassignReviewer(invoiceId, { userAccountId, forCase: false }).then(
            () => onAssigned(people?.find((person) => person.userAccountId === userAccountId)?.displayName ?? 'them'),
            (err: unknown) => setError(apiErrorMessage(err, 'Could not assign the invoice.')),
          );
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </>
  );
}

// Who reviews this invoice: only people who review invoices, with how many
// each has waiting, so the work can be spread.
export function ReviewerPicker({
  invoiceId,
  reviewer,
  currentUserId,
  canChange,
  onChanged,
}: {
  invoiceId: string;
  reviewer: AssignedPerson | null;
  currentUserId: string;
  canChange: boolean;
  // Undo restores the previous reviewer; omitted when there was none.
  onChanged: (message: string, undo?: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const people = useReviewPeople(open);
  const [chosen, setChosen] = useState<string>(reviewer?.userAccountId ?? '');
  const [forCase, setForCase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChosen(reviewer?.userAccountId ?? '');
  }, [reviewer?.userAccountId]);

  const chosenName = people?.find((person) => person.userAccountId === chosen)?.displayName;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const previous = reviewer?.userAccountId;
      await reassignReviewer(invoiceId, { userAccountId: chosen, forCase });
      setOpen(false);
      onChanged(
        `Given to ${chosenName ?? 'the new reviewer'}.`,
        previous && previous !== chosen ? () => reassignReviewer(invoiceId, { userAccountId: previous, forCase: false }) : undefined,
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change the reviewer.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="popover-anchor">
      <button
        type="button"
        className="btn btn--outline btn--select"
        aria-expanded={open}
        disabled={!canChange}
        onClick={() => setOpen(!open)}
      >
        <span className="muted">Reviewer</span> {reviewer ? reviewer.displayName : 'Not assigned'}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Who reviews this invoice?">
          <h3>Who reviews this invoice?</h3>
          {!people ? (
            <p role="status">Loading…</p>
          ) : (
            <ul className="choice-list">
              {people
                .filter((person) => person.reviewsLines)
                .map((person) => (
                  <li key={person.userAccountId}>
                    <label className={chosen === person.userAccountId ? 'is-chosen' : undefined}>
                      <input
                        type="radio"
                        name={`reviewer-${invoiceId}`}
                        checked={chosen === person.userAccountId}
                        onChange={() => setChosen(person.userAccountId)}
                      />
                      <span>
                        {person.displayName}
                        {person.userAccountId === currentUserId && ' (you)'}
                        <span className="cell-note">
                          {person.roleName}. {person.waiting} waiting.
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
          )}
          <p className="cell-note">Only people who review invoices appear here. Who works on the case does not change.</p>
          <label className="checkbox-row">
            <input type="checkbox" checked={forCase} onChange={(event) => setForCase(event.target.checked)} />
            Send new invoices on this case to {chosenName ?? 'them'} too
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="button-row">
            <button type="button" className="btn btn--primary" disabled={!chosen || saving} onClick={() => void save()}>
              Give it to {chosenName ?? '…'}
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Who signs off after review, in order. The reviewer can change it from the
// default in Settings until they finish.
export function SignOffApprovers({
  invoiceId,
  approvers,
  canChange,
  onChanged,
}: {
  invoiceId: string;
  approvers: AssignedPerson[];
  canChange: boolean;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const people = useReviewPeople(editing);
  const [chosen, setChosen] = useState<string[]>(approvers.map((approver) => approver.userAccountId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChosen(approvers.map((approver) => approver.userAccountId));
  }, [approvers]);

  async function save() {
    setError(null);
    try {
      await setSignOffApprovers(invoiceId, chosen);
      setEditing(false);
      onChanged('Sign-off changed.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change who signs off.'));
    }
  }

  return (
    <div className="sign-off-approvers">
      <span>
        <span className="muted">Signs off: </span>
        {approvers.length > 0 ? approvers.map((approver) => approver.displayName).join(', then ') : 'No one chosen yet'}
      </span>
      {canChange && !editing && (
        <button type="button" className="link-button" onClick={() => setEditing(true)}>Change</button>
      )}
      {editing && (
        <div className="inline-editor">
          {!people ? (
            <p role="status">Loading…</p>
          ) : (
            <OrderedChoiceList
              options={people.filter((person) => person.signsOff)}
              optionKey={(person) => person.userAccountId}
              chosen={chosen}
              onChange={setChosen}
              render={(person) => (
                <>
                  {person.displayName}
                  <span className="cell-note">{person.roleName}</span>
                </>
              )}
            />
          )}
          <p className="cell-note">They sign off in the order you tick them.</p>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="button-row">
            <button type="button" className="btn btn--primary" disabled={chosen.length === 0} onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
