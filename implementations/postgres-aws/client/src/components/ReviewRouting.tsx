import { useEffect, useState } from 'react';
import {
  apiErrorMessage,
  listReviewPeople,
  reassignReviewer,
  setSignOffApprovers,
  type AssignedPerson,
  type ReviewPerson,
} from '../api/client';

function usePeople(open: boolean) {
  const [people, setPeople] = useState<ReviewPerson[] | null>(null);
  useEffect(() => {
    if (open && !people) {
      listReviewPeople().then((result) => setPeople(result.people), () => setPeople([]));
    }
  }, [open, people]);
  return people;
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
  onChanged: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const people = usePeople(open);
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
      await reassignReviewer(invoiceId, { userAccountId: chosen, forCase });
      setOpen(false);
      onChanged(`Given to ${chosenName ?? 'the new reviewer'}.`);
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
  const people = usePeople(editing);
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
            <ul className="choice-list">
              {people
                .filter((person) => person.signsOff)
                .map((person) => {
                  const position = chosen.indexOf(person.userAccountId);
                  return (
                    <li key={person.userAccountId}>
                      <label className={position >= 0 ? 'is-chosen' : undefined}>
                        <input
                          type="checkbox"
                          checked={position >= 0}
                          onChange={(event) =>
                            setChosen(
                              event.target.checked
                                ? [...chosen, person.userAccountId]
                                : chosen.filter((id) => id !== person.userAccountId),
                            )
                          }
                        />
                        <span>
                          {position >= 0 && <span className="order-badge">{position + 1}</span>}
                          {person.displayName}
                          <span className="cell-note">{person.roleName}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
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
