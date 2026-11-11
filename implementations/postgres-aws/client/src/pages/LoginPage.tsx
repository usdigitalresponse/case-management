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
import { MISSIONS, STORY } from '../tour/missions';
import { Button, buttonClass } from '../components/ui/Button';
import { useProductName } from '../components/AppBrand';

// Demos only, and never on its own: free exploration stays beside it.
function TourEntry() {
  const tour = useTour();
  if (!tour) return null;
  const minutes = STORY.reduce((total, mission) => total + MISSIONS[mission].minutes, 0);
  return (
    <section className="login-tour" aria-labelledby="login-tour">
      <div className="login-tour__bar">
        <div className="login-tour__intro">
          <h2 id="login-tour">New here? Take a guided tour</h2>
          <p>
            Take one invoice from pre-authorization to sign-off yourself, as an investigator, a reviewer and the Director. About{' '}
            {minutes} minutes, with synthetic data.
          </p>
          {tour.error && <p className="field-error" role="alert">{tour.error}</p>}
        </div>
        <Button kind="primary" disabled={tour.busy} onClick={() => void tour.start(STORY)}>
          {tour.busy ? 'Setting up your tour…' : 'Start the tour'}
        </Button>
        <div className="login-tour__parts">
          <MissionPicker id="login-mission" label="Or try one part" busy={tour.busy} onStart={(missions) => void tour.start(missions)} />
        </div>
      </div>
    </section>
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
      {/* Pinned to the bottom of the screen, below the sign-ins. */}
      {data?.demoLoginEnabled && data.externalDemoLoginEnabled && <TourEntry />}
    </div>
  );
}
