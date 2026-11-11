import { useState } from 'react';
import { Label, TextInput } from '@trussworks/react-uswds';
import { apiErrorMessage, closeCase } from '../api/client';
import { Notice } from './ui/Notice';
import { Button } from './ui/Button';

// Closes an open case whose invoices are finished (server/src/cases/closeCase.ts). A reason is required
// (the server enforces this), so opening the form is a separate step from confirming it.
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
      setError(apiErrorMessage(err, 'The case could not be closed. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return <Button type="button" kind="secondary" onClick={() => setOpen(true)}>Close case</Button>;
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
        <Button type="submit" kind="primary" disabled={submitting}>{submitting ? 'Closing…' : 'Confirm close'}</Button>
        <Button type="button" kind="secondary" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}
