import { Link as RouterLink } from 'react-router';
import type { ReviewQueueItem } from '../api/client';
import { submittedByLabel } from '../reviewTotals';
import type { RecordTableColumn } from './RecordTable';

// Cells shared by the staff tables of invoices: the queue, a case's
// invoices and Exports.

export const caseNumberColumn: RecordTableColumn<ReviewQueueItem> = {
  header: 'Case number',
  rowHeader: true,
  className: 'case-number-cell',
  render: (invoice) => (
    <>
      {invoice.caseNumber ?? '—'}
      {invoice.otherCaseNumbers.length > 0 && <span className="cell-note">{invoice.otherCaseNumbers.join(', ')}</span>}
    </>
  ),
};

export function FromCell({ invoice }: { invoice: ReviewQueueItem }) {
  return (
    <>
      {submittedByLabel(invoice)}
      <span className="cell-note">{invoice.professionalKindDisplayName ?? 'Professional'}</span>
    </>
  );
}

export function FlagNotes({ invoice }: { invoice: ReviewQueueItem }) {
  return (
    <>
      {invoice.flags.map((flag) => (
        <span key={flag.kind} className="cell-flag">{flag.message}</span>
      ))}
    </>
  );
}

// The row's link to the invoice, last in the row.
export function openInvoiceColumn(label: (invoice: ReviewQueueItem) => string): RecordTableColumn<ReviewQueueItem> {
  return {
    header: 'Open',
    hiddenHeader: true,
    align: 'right',
    render: (invoice) => (
      <RouterLink className="row-action" to={`/billing/${invoice.invoiceId}`}>
        {label(invoice)} <span aria-hidden="true">→</span>
        <span className="usa-sr-only"> invoice for {invoice.caseClientDisplayName ?? 'this case'}</span>
      </RouterLink>
    ),
  };
}
