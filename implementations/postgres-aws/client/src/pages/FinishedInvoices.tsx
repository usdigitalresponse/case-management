// Every invoice with all its lines decided, newest first: waiting for
// sign-off, decided, or completed once the sender has been told.
import { useSearchParams } from 'react-router';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { finishedRequest, FINISHED_FILTERS, type FinishedFilterId } from '../queueRequests';
import { reviewQueue } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { StatusPill } from '../components/StatusPill';
import { COMPLETED_EXPLAINER, InvoiceStatus } from '../components/Completion';
import { Toast, useToast } from '../components/Toast';
import { CaseNumberCell, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { FilterTag } from '../components/ui/Tag';

export default function FinishedInvoices() {
  const [params] = useSearchParams();
  const [filter, setFilter] = useSearchParamState<FinishedFilterId>('show', 'month', FINISHED_FILTERS.map((option) => option.id));
  const list = useBatchedResource(reviewQueue(finishedRequest(params)));
  const { summary, reload } = list;
  const [toast, setToast] = useToast();
  const county = useCountyControl(summary?.counties ?? null);

  if (list.error || !list.items || !summary) {
    return <LoadState error={list.error} what="invoices" />;
  }
  const today = formatDay(new Date().toISOString());

  return (
    <div>
      <PageHeader
        list
        title="Finished invoices"
        description="Every line on these invoices is decided. Each one belongs to the person who sent it. Case numbers are as they typed them."
      />
      <p className="compact-hint">
        <strong>Decided</strong> invoices still need you to tell the person who sent them. {COMPLETED_EXPLAINER}
      </p>
      <div className="list-controls">
        <div className="tag-filters" role="group" aria-label="Show">
          {FINISHED_FILTERS.map(({ id, label }) => (
            <FilterTag key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="tag-count">{summary.counts[id]}</span>
            </FilterTag>
          ))}
        </div>
        {county.control}
      </div>
      <RecordTable
        className="queue-table"
        rows={list.items}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={county.narrowed ? 'No invoices here for that county.' : filter === 'month' ? 'Nothing finished this month yet.' : 'No invoices here.'}
        columns={[
          { header: 'From', rowHeader: true, render: (invoice) => <FromCell invoice={invoice} /> },
          { header: 'Case number', className: 'case-number-cell', render: (invoice) => <CaseNumberCell invoice={invoice} /> },
          {
            header: 'Finished',
            render: (invoice) =>
              invoice.finishedAt ? (formatDay(invoice.finishedAt) === today ? 'Today' : formatDay(invoice.finishedAt)) : '—',
          },
          { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
          { header: 'Approved', align: 'right', className: 'approved-amount', render: (invoice) => (invoice.approvedTotal !== null ? formatMoney(invoice.approvedTotal) : '—') },
          { header: 'Reviewer', render: (invoice) => invoice.reviewer?.displayName ?? '—' },
          {
            header: 'Status',
            render: (invoice) =>
              invoice.statusCode === 'awaiting_sign_off' ? (
                <>
                  <StatusPill tone="warning" label="Waiting for sign-off" />
                  {invoice.holder && <span className="cell-note">{invoice.holder.displayName} signs off next.</span>}
                </>
              ) : (
                <InvoiceStatus
                  invoice={invoice}
                  label="Decided"
                  onCompleted={async () => {
                    await reload();
                    setToast({ message: filter === 'decided' ? 'Marked completed. It is under Completed now.' : 'Marked completed.' });
                  }}
                />
              ),
          },
          openInvoiceColumn(() => 'View'),
        ]}
      />
      <MoreOnScroll list={list} what="invoices" />
      <p className="compact-hint">
        Export any of these to a spreadsheet from the invoice. The case number in the export is the one on the invoice, as typed or as
        a reviewer corrected it.
      </p>
      <Toast toast={toast} />
    </div>
  );
}
