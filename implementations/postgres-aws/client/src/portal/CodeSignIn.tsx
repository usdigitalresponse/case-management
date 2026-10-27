// External sign-in: an email, then a 6-digit code sent to it. No password.
// The first step looks the same whether or not the email is on file, so it
// can't reveal who is allowed in. See ../../MAPPING.md "Emailed-code sign-in
// for external users".
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { apiErrorMessage, requestSignInCode } from '../api/client';
import { useAuth } from '../AuthContext';

const CODE_LENGTH = 6;

function CodeBoxes({ digits, onChange, disabled }: { digits: string[]; onChange: (digits: string[]) => void; disabled: boolean }) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (index: number) => boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();

  // Typing or pasting several digits fills the boxes from this one on.
  function fill(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    const next = [...digits];
    if (!typed) {
      next[index] = '';
      onChange(next);
      return;
    }
    typed.split('').slice(0, CODE_LENGTH - index).forEach((digit, offset) => {
      next[index + offset] = digit;
    });
    onChange(next);
    focus(index + typed.length);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      onChange(next);
      focus(index - 1);
    } else if (event.key === 'ArrowLeft') {
      focus(index - 1);
    } else if (event.key === 'ArrowRight') {
      focus(index + 1);
    }
  }

  function onPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    fill(index, event.clipboardData.getData('text'));
  }

  return (
    <div className="code-boxes">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          id={index === 0 ? 'sign-in-code' : undefined}
          className="code-box"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
          maxLength={CODE_LENGTH}
          value={digit}
          disabled={disabled}
          autoFocus={index === 0}
          onChange={(event) => fill(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}

export function CodeSignIn({ headingLevel = 'h1' }: { headingLevel?: 'h1' | 'h2' }) {
  const Heading = headingLevel;
  const { signInWithCode } = useAuth();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function sendCode(address: string) {
    setBusy(true);
    setError(null);
    try {
      await requestSignInCode(address);
      setSentTo(address);
      setDigits(Array(CODE_LENGTH).fill(''));
    } catch (err) {
      setError(apiErrorMessage(err, 'The code could not be sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  function onEmailSubmit(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (address) {
      void sendCode(address);
    }
  }

  async function onCodeSubmit(event: FormEvent) {
    event.preventDefault();
    const code = digits.join('');
    if (!sentTo || code.length !== CODE_LENGTH) {
      setError('Enter all 6 digits of the code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithCode(sentTo, code);
    } catch (err) {
      setError(apiErrorMessage(err, 'That code is wrong or has expired.'));
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form className="code-sign-in" onSubmit={onEmailSubmit} noValidate>
        <Heading>Send an invoice</Heading>
        <p className="code-sign-in__lead">
          Enter the email address the billing office has on file for you. We will email you a 6-digit code to sign in.
          There is no password.
        </p>
        <div className="code-sign-in__field">
          <label className="usa-label" htmlFor="sign-in-email">Your email</label>
          <input
            id="sign-in-email"
            className="usa-input"
            type="email"
            autoComplete="email"
            required
            aria-describedby="sign-in-email-hint"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p id="sign-in-email-hint" className="code-sign-in__hint">Use the same email you send invoices from today.</p>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div>
          <button type="submit" className="btn btn--primary" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="code-sign-in" onSubmit={(event) => void onCodeSubmit(event)} noValidate>
      <Heading>Check your email</Heading>
      <p className="code-sign-in__lead">
        We sent a 6-digit code to {sentTo}. It works once, for the next 10 minutes.
      </p>
      <div className="code-sign-in__field">
        <label className="usa-label" htmlFor="sign-in-code">Code</label>
        <CodeBoxes digits={digits} onChange={setDigits} disabled={busy} />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {resent && !error && <p className="code-sign-in__hint" role="status">We sent a new code. Earlier codes no longer work.</p>}
      <div>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
      <div className="code-sign-in__links">
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => {
            setResent(true);
            void sendCode(sentTo);
          }}
        >
          Send a new code
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => {
            setSentTo(null);
            setResent(false);
            setError(null);
          }}
        >
          Use a different email
        </button>
      </div>
      <p className="code-sign-in__hint">Nothing arrived? Check your junk folder. After 5 wrong codes you need a new one.</p>
    </form>
  );
}
