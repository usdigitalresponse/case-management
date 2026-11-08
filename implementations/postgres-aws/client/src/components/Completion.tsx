import { useState, type ReactNode } from 'react';
import { apiErrorMessage, markInvoiceCompleted } from '../api/client';
import { Notice } from './Notice';
import { StatusPill } from './StatusPill';

export const DECIDED_STATUS_CODES = ['approved', 'rejected'];

export const COMPLETED_EXPLAINER =
  'Mark it completed once you have told the person who sent it about the decision and answered anything they asked about it.';

interface CompletableInvoice {
  invoiceId: string;
  statusCode: string;
  statusDisplayName: string | null;
  completedAt: string | null;
}

export function isCompleted(invoice: CompletableInvoice) {
  return DECIDED_STATUS_CODES.includes(invoice.statusCode) && Boolean(invoice.completedAt);
}

function completedOn(completedAt: string) {
  const when = new Date(completedAt);
  return when.toDateString() === new Date().toDateString() ? 'today' : `on ${when.toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
}

// A table's status cell, with the button once decided.
export function InvoiceStatus({
  invoice,
  label = invoice.statusDisplayName,
  onCompleted,
}: {
  invoice: CompletableInvoice;
  label?: string | null;
  onCompleted: () => unknown;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!DECIDED_STATUS_CODES.includes(invoice.statusCode)) {
    return <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} />;
  }
  if (invoice.completedAt) {
    return (
      <>
        <StatusPill code={invoice.statusCode} label={label} />
        <span className="cell-note">Completed {completedOn(invoice.completedAt)}</span>
      </>
    );
  }
  return (
    <>
      <StatusPill code={invoice.statusCode} label={label} />
      <button
        type="button"
        className="btn btn--outline btn--small completion-button"
        title={COMPLETED_EXPLAINER}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await markInvoiceCompleted(invoice.invoiceId);
            await onCompleted();
          } catch (err) {
            setError(apiErrorMessage(err, 'That did not save. Try again.'));
          } finally {
            setSaving(false);
          }
        }}
      >
        Mark completed
      </button>
      {error && <span className="cell-flag">{error}</span>}
    </>
  );
}

// The invoice page's version, with the explainer in full.
export function CompletionNotice({
  completedAt,
  saving,
  onComplete,
  emailSender,
}: {
  completedAt: string | null;
  saving: boolean;
  onComplete: () => void;
  emailSender: ReactNode;
}) {
  if (completedAt) {
    return (
      <Notice tone="success" heading={`Completed ${completedOn(completedAt)}.`}>
        Everything with the person who sent it is done.
      </Notice>
    );
  }
  return (
    <Notice
      tone="info"
      heading="Decided, not yet completed."
      action={
        <>
          {emailSender}
          <button type="button" className="btn btn--outline" disabled={saving} onClick={onComplete}>
            Mark completed
          </button>
        </>
      }
    >
      {COMPLETED_EXPLAINER}
    </Notice>
  );
}
