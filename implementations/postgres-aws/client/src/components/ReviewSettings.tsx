import { useEffect, useState, type FormEvent } from 'react';
import {
  addDecisionReason,
  apiErrorMessage,
  getReviewSettings,
  getStaffRoles,
  listDecisionReasonSettings,
  listReviewPeople,
  setReviewSettings,
  setStaffRole,
  updateDecisionReason,
  type ReasonAppliesTo,
  type ReviewSettings,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { Notice, type SaveMessage } from './Notice';
import { LoadState } from './LoadState';
import { OrderedChoiceList } from './OrderedChoiceList';
import { RecordTable } from './RecordTable';
import { ReviewerSelect } from './ReviewRouting';

// Who gets new invoices, who signs off, and when a waiting invoice is called
// out. Each save adds a setting; invoices already routed keep theirs.
export function ReviewRoutingSettings({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data: settings, error } = useApiResource(() => getReviewSettings(), [version]);
  const { data: peopleData } = useApiResource(() => listReviewPeople(), [version]);
  const [draft, setDraft] = useState<ReviewSettings | null>(null);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (error || !draft || !peopleData) {
    return <LoadState error={error} what="review settings" />;
  }
  const approvers = peopleData.people.filter((person) => person.signsOff);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await setReviewSettings(draft!);
      setMessage({ tone: 'success', text: 'Saved. New invoices are routed this way from now on.' });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'The settings could not be saved.') });
    }
  }

  return (
    <form className="compact-card settings-form" onSubmit={(event) => void save(event)}>
      <h3>Routing new invoices</h3>
      <p className="compact-hint">
        A case can send its invoices to its own reviewer; this default covers the rest. With no default, new invoices
        wait unassigned until a reviewer takes one.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <label className="settings-field" htmlFor="default-reviewer">Default reviewer</label>
      <ReviewerSelect
        id="default-reviewer"
        people={peopleData.people}
        disabled={!isAdmin}
        value={draft.defaultReviewerUserAccountId ?? ''}
        emptyLabel="No one: leave new invoices unassigned"
        onChange={(userAccountId) => setDraft({ ...draft, defaultReviewerUserAccountId: userAccountId || null })}
      />
      <fieldset className="settings-field">
        <legend>Who signs off, in order</legend>
        {approvers.length === 0 && <p className="cell-note">No one has the sign-off role yet. Give someone it below.</p>}
        <OrderedChoiceList
          options={approvers}
          optionKey={(person) => person.userAccountId}
          render={(person) => person.displayName}
          disabled={!isAdmin}
          chosen={draft.defaultSignOffUserAccountIds}
          onChange={(chosen) => setDraft({ ...draft, defaultSignOffUserAccountIds: chosen })}
        />
        <p className="cell-note">Reviewers can change this for one invoice before they finish.</p>
      </fieldset>
      <label className="settings-field">
        Call out invoices waiting more than this many working days
        <input
          className="usa-input settings-number"
          type="number"
          min="1"
          max="60"
          disabled={!isAdmin}
          value={draft.waitingAlertWorkingDays}
          onChange={(event) => setDraft({ ...draft, waitingAlertWorkingDays: Number(event.target.value) })}
        />
      </label>
      <div className="settings-field">
        <span>Holiday calendar</span>
        <p className="cell-note">Working days skip weekends. Uploading a holiday calendar so holidays are skipped too is planned.</p>
        <button type="button" className="btn btn--outline" disabled title="Not available yet">Upload a calendar</button>
      </div>
      {isAdmin && (
        <div className="button-row">
          <button type="submit" className="btn btn--primary">Save</button>
        </div>
      )}
    </form>
  );
}

const LIST_LABELS: Record<ReasonAppliesTo, string> = {
  approved_in_part: 'Approving part',
  rejected: 'Rejecting',
  both: 'Both',
};

// The reasons reviewers choose from when they approve part of a line or
// reject it. Administrators keep the lists current without a code release;
// a retired reason stays on decisions that used it.
export function DecisionReasonSettings({ isAdmin }: { isAdmin: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => listDecisionReasonSettings(), [version]);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [appliesTo, setAppliesTo] = useState<ReasonAppliesTo>('rejected');

  if (error || !data) {
    return <LoadState error={error} what="decision reasons" />;
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'The reason could not be saved.') });
    }
  }

  return (
    <section className="compact-card">
      <h3>Reasons for cutting or rejecting a line</h3>
      <p className="compact-hint">
        Approving part of a line and rejecting it each have their own list. Reviewers must pick one, and "Another
        reason" needs a note.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <RecordTable
        label="Decision reasons"
        rows={data.reasons}
        rowKey={(reason) => reason.reasonId}
        rowClassName={(reason) => (reason.active ? undefined : 'is-retired')}
        columns={[
          { header: 'Reason', rowHeader: true, render: (reason) => reason.displayName },
          {
            header: 'On the list for',
            render: (reason) =>
              isAdmin && reason.code !== 'other' ? (
                <select
                  className="usa-select settings-role"
                  aria-label={`List for ${reason.displayName}`}
                  value={reason.appliesTo}
                  onChange={(event) =>
                    void run(() => updateDecisionReason(reason.reasonId, { appliesTo: event.target.value as ReasonAppliesTo }), 'Reason moved.')
                  }
                >
                  {Object.entries(LIST_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              ) : (
                LIST_LABELS[reason.appliesTo]
              ),
          },
          {
            header: 'In use',
            render: (reason) =>
              isAdmin && reason.code !== 'other' ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void run(() => updateDecisionReason(reason.reasonId, { active: !reason.active }), reason.active ? 'Reason retired.' : 'Reason restored.')}
                >
                  {reason.active ? 'Retire' : 'Restore'}
                </button>
              ) : reason.active ? (
                'Yes'
              ) : (
                'Retired'
              ),
          },
        ]}
      />
      {isAdmin && (
        <form
          className="inline-fields reason-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => addDecisionReason({ displayName: displayName.trim(), appliesTo }), 'Reason added.').then(() => setDisplayName(''));
          }}
        >
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="new-reason">New reason</label>
            <input id="new-reason" className="usa-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="new-reason-list">For</label>
            <select id="new-reason-list" className="usa-select" value={appliesTo} onChange={(event) => setAppliesTo(event.target.value as ReasonAppliesTo)}>
              {Object.entries(LIST_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn--primary" disabled={displayName.trim().length < 3}>Add reason</button>
        </form>
      )}
    </section>
  );
}

// Accounts are created when someone first signs in; administrators give
// them a role here. Every change is kept in the audit history.
export function StaffRoleSettings() {
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => getStaffRoles(), [version]);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  if (error || !data) {
    return <LoadState error={error} what="staff roles" />;
  }

  async function change(userAccountId: string, roleId: string) {
    setMessage(null);
    try {
      await setStaffRole(userAccountId, roleId);
      setMessage({ tone: 'success', text: 'Role changed.' });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'The role could not be changed.') });
    }
  }

  return (
    <section className="compact-card">
      <h3>People who use this tool</h3>
      <p className="compact-hint">
        Billing reviewers decide lines and can give invoices to each other. Sign-off approvers sign off whole invoices
        or send them back. Intake staff can look but not decide. Administrators can do everything, including Settings.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <RecordTable
        label="Staff roles"
        rows={data.people}
        rowKey={(person) => person.userAccountId}
        columns={[
          { header: 'Person', rowHeader: true, render: (person) => person.displayName },
          {
            header: 'Role',
            render: (person) => (
              <>
                <label className="usa-sr-only" htmlFor={`role-${person.userAccountId}`}>Role for {person.displayName}</label>
                <select
                  id={`role-${person.userAccountId}`}
                  className="usa-select settings-role"
                  value={data.roles.find((role) => role.displayName === person.roleName)?.roleId ?? ''}
                  onChange={(event) => void change(person.userAccountId, event.target.value)}
                >
                  {data.roles.map((role) => (
                    <option key={role.roleId} value={role.roleId}>{role.displayName}</option>
                  ))}
                </select>
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
