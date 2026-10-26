// Two independent sign-in paths, not one merged form: agency staff use
// SSO (whichever provider their organization has configured — inherits
// their org's session/MFA policy, no email round-trip); external
// partners have no pre-provisioned identity, so they request a one-time
// link by email instead. See ../../MAPPING.md "Multi-IdP SSO" and
// "Magic-link sign-in for external users".
import { useState, type FormEvent } from 'react';
import { Form, Label, TextInput } from '@trussworks/react-uswds';
import { listAuthProviders, requestMagicLink } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../AuthContext';
import { Notice } from '../components/Notice';

export default function LoginPage() {
  const { data } = useApiResource(listAuthProviders, []);
  const providers = data?.providers;
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
        <h1>Invoice Review</h1>
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
          {data?.demoLoginEnabled && (
            <div className="login-demo">
              <span>For demos</span>
              <button type="button" className="link-button" onClick={() => void demoLogin()}>
                Sign in as demo staff
              </button>
            </div>
          )}
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
            <div className="login-demo">
              <span>For demos</span>
              <button type="button" className="link-button" onClick={() => void externalDemoLogin()}>
                Sign in as a demo partner
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
