import { useState } from 'react';
import { Alert, Button, TextInput } from '@trussworks/react-uswds';
import { reviewInvoice } from '../api/client';

// Approve/reject actions for one queued invoice
// (../pages/BillingQueue.tsx). Rejecting needs a reason
// (server/src/billing/reviewInvoice.ts enforces this), so that path opens
// a small inline prompt instead of acting immediately like approve does.
export function InvoiceReviewActions({ invoiceId, onReviewed }: { invoiceId: string; onReviewed: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await reviewInvoice(invoiceId, 'approved');
      onReviewed();
    } catch {
      setError('Failed to approve invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await reviewInvoice(invoiceId, 'rejected', reason);
      onReviewed();
    } catch {
      setError('Failed to reject invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  if (rejecting) {
    return (
      <form className="invoice-review-reject" onSubmit={handleReject}>
        <TextInput
          id={`reject-reason-${invoiceId}`}
          name="reason"
          type="text"
          placeholder="Reason for rejection"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
        <div className="invoice-review-buttons">
          <Button type="submit" disabled={submitting}>{submitting ? 'Rejecting…' : 'Confirm reject'}</Button>
          <Button type="button" outline onClick={() => setRejecting(false)} disabled={submitting}>Cancel</Button>
        </div>
        {error && <Alert type="error" slim>{error}</Alert>}
      </form>
    );
  }

  return (
    <div className="invoice-review-buttons">
      <Button type="button" onClick={handleApprove} disabled={submitting}>
        {submitting ? 'Approving…' : 'Approve'}
      </Button>
      <Button type="button" outline onClick={() => setRejecting(true)} disabled={submitting}>Reject</Button>
      {error && <Alert type="error" slim>{error}</Alert>}
    </div>
  );
}
