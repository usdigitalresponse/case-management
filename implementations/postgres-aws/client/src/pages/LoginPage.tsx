// Two independent sign-in paths, not one merged form: agency staff use
// SSO (whichever provider their organization has configured — inherits
// their org's session/MFA policy, no email round-trip); external
// partners have no pre-provisioned identity, so they sign in with a code
// sent by email instead. See ../../docs/api.md "Multi-IdP SSO" and
// "Emailed-code sign-in for external users".
import { useState } from 'react';
import { apiErrorMessage, type DemoAccount } from '../api/client';
import { useResource } from '../hooks/useResource';
import { authProviders, demoAccounts as demoAccountsResource } from '../resources';
import { useAuth } from '../AuthContext';
import { CodeSignIn } from '../portal/CodeSignIn';
import { useTour } from '../tour/TourContext';
import { MissionPicker } from '../tour/GuidePanel';
import { STORY } from '../tour/missions';
import { Button, buttonClass } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { useProductName } from '../components/AppBrand';

// Demos only, and never on its own: free exploration stays beside it. A small
// button in the corner (design K1) opens the choice of a whole or partial tour.
function TourEntry() {
  const tour = useTour();
  const [open, setOpen] = useState(false);
  if (!tour) return null;
  return (
    <>
      <Button kind="secondary" className="login-tour-button" onClick={() => setOpen(true)}>
        Take a guided tour
      </Button>
      {open && (
        <Dialog title="Take a guided tour" className="login-tour" onClose={() => setOpen(false)}>
          <p className="login-tour__note">Uses synthetic data.</p>
          {tour.error && <p className="field-error" role="alert">{tour.error}</p>}
          <div className="login-tour__options">
            <div className="login-tour__option">
              <h3 className="mission-picker__label">The whole tour</h3>
              <p className="login-tour__text">Take one invoice from pre-authorization to sign-off, as an investigator, a reviewer and the Director.</p>
              <Button kind="primary" disabled={tour.busy} onClick={() => void tour.start(STORY)}>
                {tour.busy ? 'Setting up your tour…' : 'Start the tour'}
              </Button>
            </div>
            <div className="login-tour__option">
              <MissionPicker id="login-mission" label="One part of the tour" busy={tour.busy} onStart={(missions) => void tour.start(missions)} />
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="link-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// Demos only: sign in as any seeded synthetic account, to try each view.
function DemoSignIn({
  id,
  accounts,
  onSignIn,
}: {
  id: string;
  accounts: DemoAccount[];
  onSignIn: (userAccountId: string) => Promise<void>;
}) {
  const [userAccountId, setUserAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chosen = userAccountId || accounts[0]?.userAccountId || '';
  if (accounts.length === 0) {
    return null;
  }
  return (
    <form
      className="login-demo"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        onSignIn(chosen).catch((err: unknown) => setError(apiErrorMessage(err, 'That demo account could not sign in.')));
      }}
    >
      <label htmlFor={id}>For demos, sign in as</label>
      <div className="login-demo__row">
        <select id={id} className="usa-select" value={chosen} onChange={(event) => setUserAccountId(event.target.value)}>
          {accounts.map((account) => (
            <option key={account.userAccountId} value={account.userAccountId}>
              {account.description ? `${account.displayName} (${account.description})` : account.displayName}
            </option>
          ))}
        </select>
        <Button type="submit" kind="secondary">Sign in</Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  const { data } = useResource(authProviders);
  const providers = data?.providers;
  const demoEnabled = Boolean(data?.demoLoginEnabled || data?.externalDemoLoginEnabled);
  const { data: demoAccounts } = useResource(demoEnabled ? demoAccountsResource : null);
  const { demoLogin, externalDemoLogin } = useAuth();
  const productName = useProductName();

  return (
    <div className="login-page">
      <header className="login-intro">
        <h1>{productName}</h1>
      </header>
      <div className="login-panels">
        <section className="card login-panel" aria-labelledby="login-staff">
          <h2 id="login-staff">Staff</h2>
          <p>Use your organization's account.</p>
          {providers?.length === 0 && <p>No sign-in provider is configured yet.</p>}
          {providers?.map((provider) => (
            <a key={provider.id} className={buttonClass('primary')} href={`/auth/${provider.id}`}>
              Sign in with {provider.displayName}
            </a>
          ))}
          {data?.demoLoginEnabled && <DemoSignIn id="demo-staff" accounts={demoAccounts?.staff ?? []} onSignIn={demoLogin} />}
        </section>

        <section className="card login-panel login-panel--code" aria-label="Attorneys and vendors">
          <CodeSignIn headingLevel="h2" />
          {data?.externalDemoLoginEnabled && (
            <DemoSignIn id="demo-partner" accounts={demoAccounts?.partners ?? []} onSignIn={externalDemoLogin} />
          )}
        </section>
      </div>
      {data?.demoLoginEnabled && data.externalDemoLoginEnabled && <TourEntry />}
    </div>
  );
}
