import { useState } from 'react';
import { Dialog } from '../components/Dialog';

// Withdrawing a sent invoice (the recall transition): it leaves review and
// returns to drafts with every change kept.
export function WithdrawDialog({
  error,
  onWithdraw,
  onClose,
}: {
  error: string | null;
  onWithdraw: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Withdraw this invoice?" onClose={onClose}>
      <p>It will not be reviewed. It goes back to your drafts with every change you made, so you can fix it and send it again.</p>
      <p className="dialog__small">If you do not send it again, it cannot be paid.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onWithdraw().finally(() => setBusy(false));
          }}
        >
          {busy ? 'Withdrawing…' : 'Withdraw invoice'}
        </button>
        <button type="button" className="link-button" disabled={busy} onClick={onClose} autoFocus>
          Keep it in review
        </button>
      </div>
    </Dialog>
  );
}
