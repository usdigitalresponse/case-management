// Every invoice with all its lines decided, newest first: waiting for
// sign-off, or decided.
import { useState } from 'react';
import { listReviewQueue, type ReviewQueueItem } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { StatusPill } from '../components/StatusPill';
import { CaseNumberCell, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

const FINISHED = ['awaiting_sign_off', 'approved', 'rejected'];

const FILTERS = [
  { id: 'month', label: 'This month', tone: '' },
  { id: 'sign_off', label: 'Waiting for sign-off', tone: ' chip--warning' },
  { id: 'decided', label: 'Decided', tone: ' chip--success' },
  { id: 'all', label: 'All', tone: '' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

function matches(invoice: ReviewQueueItem, filter: FilterId): boolean {
  switch (filter) {
    case 'month':
      return Boolean(invoice.finishedAt?.startsWith(new Date().toISOString().slice(0, 7)));
    case 'sign_off':
      return invoice.statusCode === 'awaiting_sign_off';
    case 'decided':
      return invoice.statusCode !== 'awaiting_sign_off';
    default:
      return true;
  }
}

export default function FinishedInvoices() {
  const { data, error } = useApiResource(() => listReviewQueue('all'), []);
  const [filter, setFilter] = useState<FilterId>('month');

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }
  const finished = data.invoices
    .filter((invoice) => FINISHED.includes(invoice.statusCode))
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  const shown = finished.filter((invoice) => matches(invoice, filter));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Finished invoices"
        description="Every line on these invoices is decided. Each one belongs to the person who sent it. Case numbers are as they typed them."
      />
      <div className="chip-filters" role="group" aria-label="Show">
        {FILTERS.map(({ id, label, tone }) => (
          <button key={id} type="button" className={`chip chip--filter${tone}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label} <span className="chip-count">{finished.filter((invoice) => matches(invoice, id)).length}</span>
          </button>
        ))}
      </div>
      <RecordTable
        className="queue-table"
        rows={shown}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={filter === 'month' ? 'Nothing finished this month yet.' : 'No invoices here.'}
        columns={[
          { header: 'From', rowHeader: true, render: (invoice) => <FromCell invoice={invoice} /> },
          { header: 'Case number, as typed', className: 'case-number-cell', render: (invoice) => <CaseNumberCell invoice={invoice} /> },
          {
            header: 'Finished',
            render: (invoice) =>
              invoice.finishedAt ? (invoice.finishedAt.slice(0, 10) === today ? 'Today' : formatDate(invoice.finishedAt.slice(0, 10))) : '—',
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
                <StatusPill code={invoice.statusCode} label="Decided" />
              ),
          },
          openInvoiceColumn(() => 'View'),
        ]}
      />
      <p className="compact-hint">
        Export any of these to a spreadsheet from the invoice. The case number in the export is the one on the invoice, as typed or as
        a reviewer corrected it.
      </p>
    </div>
  );
}
