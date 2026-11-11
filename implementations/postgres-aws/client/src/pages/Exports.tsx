import { useResource } from '../hooks/useResource';
import { reviewQueue } from '../resources';
import { BillingRecordExportButton } from '../components/BillingRecordExportButton';
import { InvoiceExportButton } from '../components/InvoiceExportButton';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { RecordTable } from '../components/RecordTable';
import { caseNumberColumn, countyOfInvoice, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { formatMoney } from '../formatMoney';

// Signed-off invoices, ready to export for payment. Payment itself happens
// outside this system.
export default function Exports() {
  const { data, error } = useResource(reviewQueue('finished'));
  const county = useCountyControl(
    (data?.invoices ?? []).filter((invoice) => invoice.statusCode === 'approved'),
    countyOfInvoice,
  );
  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }
  return (
    <div>
      <PageHeader
        list
        title="Exports"
        description="Signed-off invoices, with every decision and reason, to send for payment."
        actions={<BillingRecordExportButton />}
      />
      <p className="compact-hint">
        The billing record has one row per invoice: case number, client, provider, amounts requested and approved, the cut and
        its reasons, status and who signed off. Export it for one county or billing period, and redact columns, for reports
        outside this tool.
      </p>
      <Notice tone="info">
        Both exports let you redact details such as the client's name before you send a file on. Check each PDF or spreadsheet for confidential information first; reasons are free text.
      </Notice>
      <div className="list-controls">{county.control}</div>
      <RecordTable
        className="queue-table"
        rows={county.shown}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={county.narrowed ? 'No signed-off invoices for that county.' : 'No invoices have been signed off yet.'}
        columns={[
          caseNumberColumn,
          { header: 'Client', render: (invoice) => invoice.caseClientDisplayName ?? '—' },
          { header: 'From', render: (invoice) => <FromCell invoice={invoice} /> },
          { header: 'Approved', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.approvedTotal ?? 0)}</strong> },
          { header: 'Export', render: (invoice) => <InvoiceExportButton scope="staff" invoiceId={invoice.invoiceId} compact /> },
          openInvoiceColumn(() => 'View'),
        ]}
      />
    </div>
  );
}
