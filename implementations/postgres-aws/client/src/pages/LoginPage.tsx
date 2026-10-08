// Two independent sign-in paths, not one merged form: agency staff use
// SSO (whichever provider their organization has configured — inherits
// their org's session/MFA policy, no email round-trip); external
// partners have no pre-provisioned identity, so they request a one-time
// link by email instead. See ../../MAPPING.md "Multi-IdP SSO" and
// "Magic-link sign-in for external users".
import { useState, type FormEvent } from 'react';
import { Alert, Button, Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import { listAuthProviders, requestMagicLink } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../AuthContext';

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
      <section className="login-panel">
        <h1>Sign in</h1>
        <p>Staff sign in with their organization's account.</p>
        {providers?.length === 0 && <p>No sign-in provider is configured yet.</p>}
        {providers?.map((provider) => (
          <a key={provider.id} className="usa-button" href={`/auth/${provider.id}`}>
            Sign in with {provider.displayName}
          </a>
        ))}
        {data?.demoLoginEnabled && (
          <Button type="button" outline onClick={() => void demoLogin()}>
            Demo sign-in
          </Button>
        )}
      </section>

      <section className="login-panel">
        <h2>External partners</h2>
        <p>Enter your email for a one-time sign-in link.</p>
        {requested ? (
          <Alert type="success">
            <strong>Check your email.</strong> If that address is recognized, a sign-in link is on its way. The
            link expires in 15 minutes.
          </Alert>
        ) : (
          <Form onSubmit={(event) => void handleSubmit(event)}>
            <FormGroup>
              <Label htmlFor="magic-link-email">Email address</Label>
              <TextInput
                id="magic-link-email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormGroup>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send me a sign-in link'}
            </Button>
          </Form>
        )}
        {data?.externalDemoLoginEnabled && (
          <Button type="button" outline onClick={() => void externalDemoLogin()}>
            Demo partner sign-in
          </Button>
        )}
      </section>
    </div>
  );
}
