// Two independent sign-in paths, not one merged form: agency staff use
// SSO (whichever provider their organization has configured — inherits
// their org's session/MFA policy, no email round-trip); external
// partners have no pre-provisioned identity, so they request a one-time
// link by email instead. See ../../MAPPING.md "Multi-IdP SSO" and
// "Magic-link sign-in for external users".
import { useState, type FormEvent } from 'react';
import { Form, Label, TextInput } from '@trussworks/react-uswds';
import { apiErrorMessage, listAuthProviders, listDemoAccounts, requestMagicLink, type DemoAccount } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../AuthContext';
import { Notice } from '../components/Notice';

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
        <button type="submit" className="btn btn--outline">Sign in</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  const { data } = useApiResource(listAuthProviders, []);
  const providers = data?.providers;
  const demoEnabled = Boolean(data?.demoLoginEnabled || data?.externalDemoLoginEnabled);
  const { data: demoAccounts } = useApiResource(
    () => (demoEnabled ? listDemoAccounts() : Promise.resolve({ staff: [], partners: [] })),
    [demoEnabled],
  );
  const { demoLogin, externalDemoLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requested, setRequested] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }
    setSubmitting(true);
    try {
      await requestMagicLink(email.trim());
      setRequested(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <header className="login-intro">
        <h1>Invoice Review Prototype</h1>
      </header>
      <div className="login-panels">
        <section className="login-panel" aria-labelledby="login-staff">
          <h2 id="login-staff">Staff</h2>
          <p>Use your organization's account.</p>
          {providers?.length === 0 && <p>No sign-in provider is configured yet.</p>}
          {providers?.map((provider) => (
            <a key={provider.id} className="btn btn--primary" href={`/auth/${provider.id}`}>
              Sign in with {provider.displayName}
            </a>
          ))}
          {data?.demoLoginEnabled && <DemoSignIn id="demo-staff" accounts={demoAccounts?.staff ?? []} onSignIn={demoLogin} />}
        </section>

        <section className="login-panel" aria-labelledby="login-partners">
          <h2 id="login-partners">External Partners</h2>
          <p>We'll email you a one-time sign-in link.</p>
          {requested ? (
            <Notice tone="success" heading="Check your email.">
              If that address is recognized, a sign-in link is on its way. The link expires in 15 minutes.
            </Notice>
          ) : (
            <Form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
              <div>
                <Label htmlFor="magic-link-email">Email address</Label>
                <TextInput
                  id="magic-link-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </Form>
          )}
          {data?.externalDemoLoginEnabled && (
            <DemoSignIn id="demo-partner" accounts={demoAccounts?.partners ?? []} onSignIn={externalDemoLogin} />
          )}
        </section>
      </div>
    </div>
  );
}
