// Every invoice with all its lines decided, newest first: waiting for
// sign-off, decided, or completed once the sender has been told.
import type { ReviewQueueItem } from '../api/client';
import { useResource } from '../hooks/useResource';
import { reviewQueue } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { StatusPill } from '../components/StatusPill';
import { COMPLETED_EXPLAINER, DECIDED_STATUS_CODES, InvoiceStatus, isCompleted } from '../components/Completion';
import { Toast, useToast } from '../components/Toast';
import { CaseNumberCell, countyOfInvoice, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { FilterTag } from '../components/ui/Tag';

const FINISHED = ['awaiting_sign_off', ...DECIDED_STATUS_CODES];

const FILTERS = [
  { id: 'month', label: 'This month', tone: undefined },
  { id: 'sign_off', label: 'Waiting for sign-off', tone: 'warning' },
  { id: 'decided', label: 'Decided', tone: 'success' },
  { id: 'completed', label: 'Completed', tone: undefined },
  { id: 'all', label: 'All', tone: undefined },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

function matches(invoice: ReviewQueueItem, filter: FilterId): boolean {
  switch (filter) {
    case 'month':
      return Boolean(invoice.finishedAt?.startsWith(new Date().toISOString().slice(0, 7)));
    case 'sign_off':
      return invoice.statusCode === 'awaiting_sign_off';
    case 'decided':
      return invoice.statusCode !== 'awaiting_sign_off' && !isCompleted(invoice);
    case 'completed':
      return isCompleted(invoice);
    default:
      return true;
  }
}

export default function FinishedInvoices() {
  const { data, error, reload } = useResource(reviewQueue('all'));
  const [filter, setFilter] = useSearchParamState<FilterId>('show', 'month', FILTERS.map((option) => option.id));
  const [toast, setToast] = useToast();
  const finished = (data?.invoices ?? [])
    .filter((invoice) => FINISHED.includes(invoice.statusCode))
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  const county = useCountyControl(
    finished.filter((invoice) => matches(invoice, filter)),
    countyOfInvoice,
  );

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }
  const shown = county.shown;
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
          {FILTERS.map(({ id, label, tone }) => (
            <FilterTag key={id} tone={tone} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="tag-count">{finished.filter((invoice) => matches(invoice, id)).length}</span>
            </FilterTag>
          ))}
        </div>
        {county.control}
      </div>
      <RecordTable
        className="queue-table"
        rows={shown}
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
          { header: 'Approved', align: 'right', render: (invoice) => (invoice.approvedTotal !== null ? formatMoney(invoice.approvedTotal) : '—') },
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
      <p className="compact-hint">
        Export any of these to a spreadsheet from the invoice. The case number in the export is the one on the invoice, as typed or as
        a reviewer corrected it.
      </p>
      <Toast toast={toast} />
    </div>
  );
}
