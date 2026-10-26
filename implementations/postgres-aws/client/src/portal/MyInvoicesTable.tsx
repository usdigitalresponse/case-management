import { Link as RouterLink } from 'react-router';
import type { InvoiceRecord as MyInvoiceRecord } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { RecordTable, type RecordTableColumn } from '../components/RecordTable';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

// A submitter's invoices: on Your invoices (every case) and a case's page
// (one case, so no client column). Widths are shared, so tables repeated on
// a page line up.
export function MyInvoicesTable({
  rows,
  label,
  emptyMessage,
  showClient = true,
  onDeleted,
}: {
  rows: MyInvoiceRecord[];
  label: string;
  emptyMessage?: string;
  showClient?: boolean;
  // Offers Delete where the invoice allows it.
  onDeleted?: () => void;
}) {
  const client: RecordTableColumn<MyInvoiceRecord> = {
    header: 'Client',
    width: '24%',
    rowHeader: true,
    render: (invoice) => (
      <>
        {invoice.caseClientDisplayName ?? 'Unknown client'}
        {invoice.caseExternalReference && <span className="cell-note">{invoice.caseExternalReference}</span>}
      </>
    ),
  };
  return (
    <RecordTable
      label={label}
      className="queue-table"
      rows={rows}
      rowKey={(invoice) => invoice.invoiceId}
      emptyMessage={emptyMessage}
      columns={[
        ...(showClient ? [client] : []),
        { header: 'For', width: '20%', render: (invoice) => invoice.professionalDisplayName ?? '—' },
        {
          header: 'Submitted',
          width: '16%',
          // A recall clears submittedAt; show the earlier submission.
          render: (invoice) =>
            invoice.submittedAt ? (
              formatDate(invoice.submittedAt.slice(0, 10))
            ) : invoice.lastSubmittedAt ? (
              <>
                {formatDate(invoice.lastSubmittedAt.slice(0, 10))}
                <span className="cell-note">Then recalled</span>
              </>
            ) : (
              <span className="muted">Not yet</span>
            ),
        },
        { header: 'Requested', width: '14%', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
        { header: 'Status', width: '14%', render: (invoice) => <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /> },
        {
          header: 'Open',
          width: '12%',
          align: 'right',
          hiddenHeader: true,
          render: (invoice) => (
            <span className="row-actions">
              <RouterLink className="row-action" to={`/portal/invoices/${invoice.invoiceId}`}>
                {invoice.statusCode === 'draft' ? 'Finish' : 'Open'} <span aria-hidden="true">→</span>
              </RouterLink>
              {onDeleted && invoice.deletable && <DeleteInvoiceButton compact invoiceId={invoice.invoiceId} onDeleted={onDeleted} />}
            </span>
          ),
        },
      ]}
    />
  );
}
