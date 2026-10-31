import { useState, type ReactNode } from 'react';
import { ATTESTATION_STATEMENT } from '../api/client';
import { Dialog } from '../components/Dialog';
import { formatMoney } from '../formatMoney';

// Confirms what is being sent; Send stays off until the true-and-correct tick,
// or, for staff, until `ready` (how it was received, in `children`).
export function SendDialog({
  caseHeading = 'Case',
  caseLabel,
  period,
  linesSummary,
  askingFor,
  email,
  statement = ATTESTATION_STATEMENT,
  ready = true,
  explanation = 'Reviewers will see your original file next to these lines, and every change you made. You can withdraw the invoice until review starts.',
  children,
  error,
  onSend,
  onClose,
}: {
  caseHeading?: string;
  caseLabel: string;
  period: string;
  linesSummary: string;
  askingFor: number | null;
  email: string | undefined;
  // Null: nothing to tick (staff sending an invoice received elsewhere).
  statement?: string | null;
  ready?: boolean;
  explanation?: string;
  children?: ReactNode;
  error: string | null;
  onSend: () => Promise<void>;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Send this invoice for review?" onClose={onClose}>
      <dl className="send-summary">
        <dt>{caseHeading}</dt>
        <dd>{caseLabel}</dd>
        <dt>Billing period</dt>
        <dd>{period}</dd>
        <dt>Lines</dt>
        <dd>{linesSummary}</dd>
        <dt>{statement ? 'You are asking for' : 'Asking for'}</dt>
        <dd className="send-summary__total">{formatMoney(askingFor)}</dd>
      </dl>
      <p>{explanation}</p>
      {email && <p className="dialog__small">Sending as {email}. You signed in with the code we emailed you.</p>}
      {children}
      {statement && (
        <label className="attest">
          <input type="checkbox" checked={ticked} onChange={(event) => setTicked(event.target.checked)} />
          <span>{statement}</span>
        </label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={(statement !== null && !ticked) || !ready || busy}
          onClick={() => {
            setBusy(true);
            void onSend().finally(() => setBusy(false));
          }}
        >
          {busy ? 'Sending…' : 'Send for review'}
        </button>
        <button type="button" className="link-button" disabled={busy} onClick={onClose}>
          Keep checking
        </button>
      </div>
    </Dialog>
  );
}
