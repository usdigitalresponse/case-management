// Landing page for the emailed sign-in link. Signing in takes an explicit
// click (a POST) rather than happening on page load, because email link
// scanners fetch every link before the user does and would otherwise spend
// the single-use token.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button } from '@trussworks/react-uswds';
import { useAuth } from '../AuthContext';

export default function MagicLinkConfirm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { verifyMagicLink } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleContinue() {
    setSubmitting(true);
    try {
      await verifyMagicLink(token);
      navigate('/', { replace: true });
    } catch {
      setFailed(true);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-panel">
        <h1>Sign in</h1>
        {failed || !token ? (
          <>
            <Alert type="error" slim>
              This sign-in link is invalid, expired, or already used.
            </Alert>
            <a className="usa-button" href="/">Request a new link</a>
          </>
        ) : (
          <>
            <p>Continue to sign in to Case Management.</p>
            <Button type="button" disabled={submitting} onClick={() => void handleContinue()}>
              {submitting ? 'Signing in…' : 'Continue'}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
