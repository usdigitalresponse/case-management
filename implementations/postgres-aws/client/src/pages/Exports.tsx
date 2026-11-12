import { useSearchParams } from 'react-router';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { exportsRequest } from '../queueRequests';
import { reviewQueue } from '../resources';
import { BillingRecordExportButton } from '../components/BillingRecordExportButton';
import { InvoiceExportButton } from '../components/InvoiceExportButton';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { RecordTable } from '../components/RecordTable';
import { caseNumberColumn, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { formatMoney } from '../formatMoney';
import { formatDay } from '../formatDateTime';

// Signed-off invoices, ready to export for payment. Payment itself happens
// outside this system.
export default function Exports() {
  const [params] = useSearchParams();
  const list = useBatchedResource(reviewQueue(exportsRequest(params)));
  const county = useCountyControl(list.summary?.counties ?? null);
  if (list.error || !list.items) {
    return <LoadState error={list.error} what="invoices" />;
  }
  return (
    <div>
      <PageHeader
        list
        title="Exports"
        description="Signed-off invoices, with every decision and reason, to send for payment."
      />
      <section className="card export-card" aria-labelledby="billing-record-heading">
        <h2 id="billing-record-heading">Billing record</h2>
        <p className="cell-note">
          One row per invoice: case number, client, provider, amounts requested and approved, the cut and its reasons, status and
          who signed off. Export it for one county or billing period, and redact columns, for reports outside this tool.
        </p>
        <BillingRecordExportButton />
      </section>
      <Notice tone="info">
        Both exports let you redact details such as the client's name before you send a file on. Check each PDF or spreadsheet for confidential information first; reasons are free text.
      </Notice>
      <div className="list-controls">{county.control}</div>
      <RecordTable
        className="queue-table"
        rows={list.items}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={county.narrowed ? 'No signed-off invoices for that county.' : 'No invoices have been signed off yet.'}
        columns={[
          caseNumberColumn,
          { header: 'Client', render: (invoice) => invoice.caseClientDisplayName ?? '—' },
          { header: 'From', render: (invoice) => <FromCell invoice={invoice} /> },
          { header: 'Signed off', render: (invoice) => (invoice.finishedAt ? formatDay(invoice.finishedAt) : '—') },
          { header: 'Approved', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.approvedTotal ?? 0)}</strong> },
          { header: 'Export', align: 'right', render: (invoice) => <InvoiceExportButton scope="staff" invoiceId={invoice.invoiceId} /> },
          openInvoiceColumn(() => 'View'),
        ]}
      />
      <MoreOnScroll list={list} what="invoices" />
    </div>
  );
}
