import { useState } from 'react';
import { ATTESTATION_STATEMENT } from '../api/client';
import { Dialog } from '../components/Dialog';
import { formatMoney } from '../formatMoney';

// Sending for review (F9): one confirmation with what is being sent and the
// true-and-correct tick, without which Send does nothing.
export function SendDialog({
  caseLabel,
  period,
  linesSummary,
  askingFor,
  email,
  error,
  onSend,
  onClose,
}: {
  caseLabel: string;
  period: string;
  linesSummary: string;
  askingFor: number | null;
  email: string | undefined;
  error: string | null;
  onSend: () => Promise<void>;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Send this invoice for review?" onClose={onClose}>
      <dl className="send-summary">
        <dt>Case</dt>
        <dd>{caseLabel}</dd>
        <dt>Billing period</dt>
        <dd>{period}</dd>
        <dt>Lines</dt>
        <dd>{linesSummary}</dd>
        <dt>You are asking for</dt>
        <dd className="send-summary__total">{formatMoney(askingFor)}</dd>
      </dl>
      <p>
        Reviewers will see your original file next to these lines, and every change you made. You can withdraw the invoice
        until review starts.
      </p>
      {email && <p className="dialog__small">Sending as {email}. You signed in with the code we emailed you.</p>}
      <label className="attest">
        <input type="checkbox" checked={ticked} onChange={(event) => setTicked(event.target.checked)} />
        <span>{ATTESTATION_STATEMENT}</span>
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ticked || busy}
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
