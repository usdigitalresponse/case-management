import { listReviewQueue } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { InvoiceExportLinks } from '../components/InvoiceExportLinks';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { caseNumberColumn, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { formatMoney } from '../formatMoney';

// Signed-off invoices, ready to export for payment. Payment itself happens
// outside this system.
export default function Exports() {
  const { data, error } = useApiResource(() => listReviewQueue('finished'), []);
  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }
  return (
    <div>
      <PageHeader title="Exports" description="Signed-off invoices, with every decision and reason, to send for payment." />
      <Notice tone="info">
        Check each PDF or spreadsheet for confidential information before you send it. This system does not remove it.
      </Notice>
      <RecordTable
        className="queue-table"
        rows={data.invoices.filter((invoice) => invoice.statusCode === 'approved')}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage="No invoices have been signed off yet."
        columns={[
          caseNumberColumn,
          { header: 'Client', render: (invoice) => invoice.caseClientDisplayName ?? '—' },
          { header: 'From', render: (invoice) => <FromCell invoice={invoice} /> },
          { header: 'Approved', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.approvedTotal ?? 0)}</strong> },
          { header: 'Export', render: (invoice) => <InvoiceExportLinks scope="staff" invoiceId={invoice.invoiceId} /> },
          openInvoiceColumn(() => 'View'),
        ]}
      />
    </div>
  );
}
