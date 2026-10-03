import { useState } from 'react';
import { Alert, Button, Label, TextInput } from '@trussworks/react-uswds';
import { ApiError, closeCase } from '../api/client';

// Closes an open case, from any stage (server/src/cases/closeCase.ts). A reason is required (the server
// enforces this), so opening the form is a separate step from confirming
// it, same shape as InvoiceReviewActions' reject flow.
export function CloseCaseAction({ caseId, onClosed }: { caseId: string; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [reasonDetail, setReasonDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await closeCase(caseId, reasonDetail);
      onClosed();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'This case is already closed.'
          : 'Failed to close case.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return <Button type="button" outline onClick={() => setOpen(true)}>Close case</Button>;
  }

  return (
    <form className="close-case-form" onSubmit={handleSubmit}>
      <Label htmlFor="close-case-reason">Reason for closing</Label>
      <TextInput
        id="close-case-reason"
        name="reasonDetail"
        type="text"
        value={reasonDetail}
        onChange={(event) => setReasonDetail(event.target.value)}
        required
      />
      <div className="close-case-buttons">
        <Button type="submit" disabled={submitting}>{submitting ? 'Closing…' : 'Confirm close'}</Button>
        <Button type="button" outline onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
      </div>
      {error && <Alert type="error" slim>{error}</Alert>}
    </form>
  );
}
