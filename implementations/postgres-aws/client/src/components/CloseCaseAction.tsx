import { useState } from 'react';
import { Label, TextInput } from '@trussworks/react-uswds';
import { ApiError, closeCase } from '../api/client';
import { Notice } from './Notice';

// Closes an open case, from any stage (server/src/cases/closeCase.ts). A reason is required (the server
// enforces this), so opening the form is a separate step from confirming it.
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
    return <button type="button" className="btn btn--outline" onClick={() => setOpen(true)}>Close case</button>;
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
        <button type="submit" className="btn btn--primary" disabled={submitting}>{submitting ? 'Closing…' : 'Confirm close'}</button>
        <button type="button" className="btn btn--outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}
