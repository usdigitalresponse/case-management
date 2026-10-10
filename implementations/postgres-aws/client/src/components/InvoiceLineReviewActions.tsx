import { useState } from 'react';
import { Alert, Button, TextInput } from '@trussworks/react-uswds';
import { apiErrorMessage, reviewInvoiceLine } from '../api/client';

// Approve (editable amount, at most the requested one) or reject with a
// reason; server/src/billing/reviewInvoiceLine.ts enforces both.
export function InvoiceLineReviewActions({
  invoiceId,
  invoiceLineId,
  requestedAmount,
  onReviewed,
}: {
  invoiceId: string;
  invoiceLineId: string;
  requestedAmount: string;
  onReviewed: () => void;
}) {
  const [approvedAmount, setApprovedAmount] = useState(requestedAmount);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await reviewInvoiceLine(invoiceId, invoiceLineId, { outcome: 'approved', approvedAmount: Number(approvedAmount) });
      onReviewed();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to approve invoice item.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await reviewInvoiceLine(invoiceId, invoiceLineId, { outcome: 'rejected', reason });
      onReviewed();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to reject invoice item.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (rejecting) {
    return (
      <form className="invoice-review-reject" onSubmit={handleReject}>
        <TextInput
          id={`reject-reason-${invoiceLineId}`}
          name="reason"
          type="text"
          placeholder="Reason for rejection"
          aria-label="Reason for rejection"
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
    <form className="invoice-review-buttons" onSubmit={handleApprove}>
      <TextInput
        id={`approved-amount-${invoiceLineId}`}
        className="invoice-review-amount"
        name="approvedAmount"
        type="number"
        inputMode="decimal"
        aria-label="Approved amount"
        min="0.01"
        max={requestedAmount}
        step="0.01"
        value={approvedAmount}
        onChange={(event) => setApprovedAmount(event.target.value)}
        required
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Approving…' : 'Approve'}
      </Button>
      <Button type="button" outline onClick={() => setRejecting(true)} disabled={submitting}>Reject</Button>
      {error && <Alert type="error" slim>{error}</Alert>}
    </form>
  );
}
