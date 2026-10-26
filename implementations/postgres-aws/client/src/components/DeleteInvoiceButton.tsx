import { useState } from 'react';
import { apiErrorMessage, deleteInvoice } from '../api/client';
import { ConfirmButton } from './ConfirmButton';
import { Notice } from './Notice';

// Show only where the server says the invoice is `deletable`.
export function DeleteInvoiceButton({
  invoiceId,
  onDeleted,
  disabled,
  compact,
}: {
  invoiceId: string;
  onDeleted: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setError(null);
    try {
      await deleteInvoice(invoiceId);
      onDeleted();
    } catch (err) {
      setError(apiErrorMessage(err, 'The invoice could not be deleted.'));
    }
  }
  return (
    <>
      <ConfirmButton
        label={compact ? 'Delete' : 'Delete invoice'}
        prompt="Delete this invoice permanently? This can't be undone."
        confirmLabel="Yes, delete"
        disabled={disabled}
        compact={compact}
        onConfirm={() => void remove()}
      />
      {error && <Notice tone="danger">{error}</Notice>}
    </>
  );
}
