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
import { Button, buttonClass } from '../components/ui/Button';

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

  return (
    <div className="login-page">
      <header className="login-intro">
        <h1>Invoice Review Prototype</h1>
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
    </div>
  );
}
