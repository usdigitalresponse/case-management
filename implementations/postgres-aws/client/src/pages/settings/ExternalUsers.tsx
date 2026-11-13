// Office billing staff: external users who send invoices for an office's
// providers sign in with an emailed code only once an administrator turns it
// on here; providers' own sign-in is in ./ProvidersSettings.tsx (design K51).
import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  addDelegateOffice,
  apiErrorMessage,
  endDelegateOffice,
  searchExternalUserCandidates,
  setExternalSignIn,
  turnOnExternalSignIn,
  type ExternalUser,
  type TurnOnExternalSignIn,
} from '../../api/client';
import { useBatchedResource } from '../../hooks/useBatchedResource';
import { useResource } from '../../hooks/useResource';
import { useSearchParamText } from '../../hooks/useSearchParamState';
import { delegateOffices, externalUsers } from '../../resources';
import { ADD_NEW, PickOrAdd } from '../../components/PickOrAdd';
import { MoreOnScroll } from '../../components/MoreOnScroll';
import { RecordTable } from '../../components/RecordTable';
import { StatusPill } from '../../components/StatusPill';
import { LoadState } from '../../components/LoadState';
import { Notice, type SaveMessage } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { formatDay } from '../../formatDateTime';

const SIGN_IN_PATH = '/submit';

function signInNotice(user: ExternalUser): string {
  return `${user.displayName} can now sign in at ${window.location.origin}${SIGN_IN_PATH} with ${user.email ?? 'their email'}. The tool doesn't email them, so let them know.`;
}

function whatTheyDo(user: ExternalUser): string {
  const sendsFor = user.delegateFor.length > 0 ? `Sends for ${user.delegateFor.map((one) => one.displayName).join(', ')}` : null;
  return [user.kind, sendsFor].filter(Boolean).join('; ') || '—';
}

export function ExternalUserSettings({ isAdmin }: { isAdmin: boolean }) {
  const [query, setQuery] = useSearchParamText('externalQ');
  const [params] = useSearchParams();
  const [version, setVersion] = useState(0);
  const list = useBatchedResource(externalUsers(params.get('externalQ') ?? ''), { resetKey: version });
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [adding, setAdding] = useState(false);
  const [officesFor, setOfficesFor] = useState<ExternalUser | null>(null);

  async function toggle(user: ExternalUser) {
    setMessage(null);
    try {
      await setExternalSignIn(user.personId, !user.signInEnabled);
      setMessage({
        tone: 'success',
        text: user.signInEnabled ? `${user.displayName} can no longer sign in, and is signed out.` : signInNotice(user),
      });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'Their sign-in could not be changed.') });
    }
  }

  return (
    <section className="card compact-card">
      <div className="section-title-row">
        <h3>Office billing staff who can sign in</h3>
        {isAdmin && !adding && (
          <Button kind="primary" onClick={() => setAdding(true)}>
            Add office billing staff
          </Button>
        )}
      </div>
      {adding && (
        <LetExternalUserSignIn
          onCancel={() => setAdding(false)}
          onDone={(user) => {
            setAdding(false);
            setMessage({ tone: 'success', text: signInNotice(user) });
            setVersion((v) => v + 1);
          }}
        />
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <label className="list-controls__search">
        <span className="usa-sr-only">Search office billing staff</span>
        <input className="usa-input" type="search" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {list.error || !list.items ? (
        <LoadState error={list.error} what="office billing staff" />
      ) : (
        <>
          <RecordTable<ExternalUser>
            label="Office billing staff who can sign in"
            rows={list.items}
            rowKey={(user) => user.personId}
            emptyMessage={query.trim() ? 'No one matches.' : 'No office billing staff can sign in yet.'}
            columns={[
              {
                header: 'Person',
                rowHeader: true,
                render: (user) => (
                  <>
                    {user.displayName}
                    <span className="cell-note">{user.email ?? 'No email'}</span>
                  </>
                ),
              },
              {
                header: 'Sends invoices as',
                render: (user) => (
                  <span className="row-actions">
                    {whatTheyDo(user)}
                    {isAdmin && (
                      <button type="button" className="link-button" onClick={() => setOfficesFor(user)}>
                        Offices…{' '}
                        <span className="usa-sr-only">for {user.displayName}</span>
                      </button>
                    )}
                  </span>
                ),
              },
              {
                header: 'Sign-in',
                render: (user) => (
                  <span className="row-actions">
                    <StatusPill tone={user.signInEnabled ? 'success' : 'neutral'} label={user.signInEnabled ? 'On' : 'Off'} />
                    <span className="cell-note">
                      {!user.signInEnabled && user.signInChangedAt
                        ? `Turned off ${formatDay(user.signInChangedAt)}`
                        : user.hasSignedIn
                          ? 'Has signed in'
                          : "Hasn't signed in yet"}
                    </span>
                    {isAdmin && (
                      <button type="button" className="link-button" onClick={() => void toggle(user)}>
                        {user.signInEnabled ? 'Turn off' : 'Turn on'}{' '}
                        <span className="usa-sr-only">sign-in for {user.displayName}</span>
                      </button>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <MoreOnScroll list={list} what="office billing staff" />
        </>
      )}
      {officesFor && (
        <DelegateOffices
          user={officesFor}
          onChanged={(changed, text) => {
            setOfficesFor(changed);
            setMessage({ tone: 'success', text });
            setVersion((v) => v + 1);
          }}
          onClose={() => setOfficesFor(null)}
        />
      )}
    </section>
  );
}

function LetExternalUserSignIn({ onDone, onCancel }: { onDone: (user: ExternalUser) => void; onCancel: () => void }) {
  const offices = useResource(delegateOffices);
  const found = useRef(new Map<string, ExternalUser>());
  const [choice, setChoice] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const chosen = choice && choice !== ADD_NEW ? found.current.get(choice) : undefined;
  const adding = choice === ADD_NEW;

  async function search(text: string) {
    const { people } = await searchExternalUserCandidates(text);
    for (const user of people) found.current.set(user.personId, user);
    return people.map((user) => ({
      value: user.personId,
      label: [user.displayName, whatTheyDo(user), user.email ?? 'no email yet', user.signInEnabled ? 'already can sign in' : null]
        .filter((part) => part && part !== '—')
        .join(' — '),
    }));
  }

  function input(): TurnOnExternalSignIn | null {
    if (adding) {
      const details = { displayName: displayName.trim(), email: email.trim() };
      return { newDelegate: { ...details, officeId } };
    }
    if (!chosen) return null;
    return chosen.email ? { personId: chosen.personId } : { personId: chosen.personId, email: email.trim() };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = input();
    if (!body) return;
    setError(null);
    setSaving(true);
    try {
      onDone(await turnOnExternalSignIn(body));
    } catch (err) {
      setError(apiErrorMessage(err, 'Their sign-in could not be turned on.'));
    } finally {
      setSaving(false);
    }
  }

  const ready = adding
    ? displayName.trim().length >= 2 && email.trim() !== '' && officeId !== ''
    : Boolean(chosen && !chosen.signInEnabled && (chosen.email || email.trim()));

  return (
    <form className="decision-panel" onSubmit={(event) => void save(event)}>
      <PickOrAdd
        id="external-user-pick"
        label="Who sends invoices for an office?"
        value={choice}
        onChange={(value) => {
          setChoice(value);
          setEmail('');
          setError(null);
        }}
        addLabel="+ Add someone new"
        placeholder="Search people by name or email"
        options={[]}
        search={search}
        selectedLabel={chosen?.displayName}
      >
        <div className="inline-fields intake-provider__fields">
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="external-user-name">Name</label>
            <input id="external-user-name" className="usa-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <div className="usa-form-group">
            <label className="usa-label" htmlFor="external-user-email">Email</label>
            <input id="external-user-email" type="email" className="usa-input" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="external-user-office">Office</label>
          <select id="external-user-office" className="usa-select" value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
            <option value="">Choose an office</option>
            {offices.data?.map((office) => (
              <option key={office.officeId} value={office.officeId}>{office.displayName}</option>
            ))}
          </select>
          <p className="field-hint">They can send invoices for the office's providers, from today.</p>
        </div>
      </PickOrAdd>
      {chosen && chosen.signInEnabled && <p className="compact-hint">{chosen.displayName} can already sign in.</p>}
      {chosen && !chosen.signInEnabled && chosen.email && (
        <p className="compact-hint">
          {chosen.displayName} will sign in with {chosen.email}.
        </p>
      )}
      {chosen && !chosen.signInEnabled && !chosen.email && (
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="external-user-new-email">Email</label>
          <p className="field-hint">{chosen.displayName} has no email yet. Add the one they'll sign in with.</p>
          <input id="external-user-new-email" type="email" className="usa-input" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="button-row">
        <Button type="submit" kind="primary" disabled={!ready || saving}>
          {adding ? 'Add office billing staff' : chosen && !chosen.email ? 'Add email and turn on sign-in' : 'Turn on sign-in'}
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// An administrator lets an external user, such as a provider, send invoices for an office's providers, or stops it.
function DelegateOffices({ user, onChanged, onClose }: { user: ExternalUser; onChanged: (user: ExternalUser, message: string) => void; onClose: () => void }) {
  const offices = useResource(delegateOffices);
  const [officeId, setOfficeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const offered = offices.data?.filter((office) => !user.delegateFor.some((one) => one.officeId === office.officeId)) ?? [];

  async function run(action: () => Promise<ExternalUser>, done: string) {
    setError(null);
    setSaving(true);
    try {
      onChanged(await action(), done);
      setOfficeId('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Their offices could not be changed.'));
    } finally {
      setSaving(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const name = offered.find((office) => office.officeId === officeId)?.displayName ?? 'the office';
    await run(() => addDelegateOffice(user.personId, officeId), `${user.displayName} can now send invoices for ${name}'s providers.`);
  }

  return (
    <Dialog title={`Offices ${user.displayName} sends invoices for`} onClose={onClose}>
      <p>As an office's billing delegate, they can send invoices for any of its providers, besides their own.</p>
      {user.delegateFor.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul className="plain-list">
          {user.delegateFor.map((one) => (
            <li key={one.officeId} className="row-actions">
              {one.displayName}
              <button
                type="button"
                className="link-button"
                disabled={saving}
                onClick={() => void run(() => endDelegateOffice(user.personId, one.officeId), `${user.displayName} no longer sends invoices for ${one.displayName}.`)}
              >
                Stop{' '}
                <span className="usa-sr-only">sending for {one.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void add(event)}>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor="delegate-office">Also send invoices for</label>
          <select id="delegate-office" className="usa-select" value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
            <option value="">Choose an office</option>
            {offered.map((office) => (
              <option key={office.officeId} value={office.officeId}>{office.displayName}</option>
            ))}
          </select>
          <p className="field-hint">From today. Stopping later keeps the record of when they could.</p>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="dialog__actions">
          <Button type="submit" kind="primary" disabled={!officeId || saving}>Add office</Button>
          <Button kind="secondary" onClick={onClose}>Done</Button>
        </div>
      </form>
    </Dialog>
  );
}
