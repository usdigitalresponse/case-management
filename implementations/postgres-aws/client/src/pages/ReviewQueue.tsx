import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { listReviewQueue, type ReviewQueueItem } from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { StatusPill } from '../components/StatusPill';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { caseNumberColumn, FlagNotes, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

const FILTERS = [
  { id: 'everyone', label: "Everyone's" },
  { id: 'mine', label: 'Assigned to you' },
  { id: 'unassigned', label: 'Not assigned yet' },
  { id: 'flagged', label: 'Has a flag' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

function matches(invoice: ReviewQueueItem, filter: FilterId, userAccountId: string): boolean {
  switch (filter) {
    case 'mine':
      return invoice.holder?.userAccountId === userAccountId;
    case 'unassigned':
      return !invoice.reviewer;
    case 'flagged':
      return invoice.flags.length > 0;
    default:
      return true;
  }
}

function matchesQuery(invoice: ReviewQueueItem, query: string): boolean {
  const haystack = [
    invoice.caseNumber,
    ...invoice.otherCaseNumbers,
    invoice.caseClientDisplayName,
    invoice.professionalDisplayName,
    invoice.submittedByDisplayName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

// The first screen: invoices waiting for a decision, who has each and how
// long it has waited (working days), so nothing quietly stalls.
export default function ReviewQueue({ view }: { view: 'open' | 'finished' }) {
  const { user } = useAuth();
  const userAccountId = user?.userAccountId ?? '';
  const [params, setParams] = useSearchParams();
  const filter: FilterId = view === 'open' ? ((params.get('show') as FilterId | null) ?? 'mine') : 'everyone';
  const query = params.get('q') ?? '';
  const { data, error } = useApiResource(() => listReviewQueue(view), [view]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ id }) => [id, data?.invoices.filter((invoice) => matches(invoice, id, userAccountId)).length ?? 0]),
      ) as Record<FilterId, number>,
    [data, userAccountId],
  );

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }

  const open = view === 'open';
  const shown = data.invoices.filter((invoice) => matches(invoice, filter, userAccountId) && (!query || matchesQuery(invoice, query)));
  const isLate = (invoice: ReviewQueueItem) => invoice.workingDaysWaiting > data.waitingAlertWorkingDays;
  const late = open ? data.invoices.filter(isLate) : [];
  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  };

  return (
    <div>
      <PageHeader
        title={open ? 'Invoices to review' : 'Finished invoices'}
        description={
          open ? 'Every invoice waiting for a decision, longest wait first.' : 'Invoices signed off or rejected. Export them from the invoice.'
        }
      />

      {late.length > 0 && (
        <Notice
          tone="warning"
          heading={`${late.length} ${late.length === 1 ? 'invoice has' : 'invoices have'} waited more than ${data.waitingAlertWorkingDays} working days.`}
        >
          {late
            .map(
              (invoice) =>
                `${invoice.caseClientDisplayName ?? 'Unknown client'}, ${formatMoney(invoice.submittedTotal)}, ${
                  invoice.holder ? `with ${invoice.holder.displayName}` : 'not assigned'
                } for ${invoice.workingDaysWaiting} working days`,
            )
            .join('. ')}
          .
        </Notice>
      )}

      {open && (
        <div className="chip-filters" role="group" aria-label="Show">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`chip chip--filter${id === 'flagged' ? ' chip--warning' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setParam('show', id)}
            >
              {label} <span className="chip-count">{counts[id]}</span>
            </button>
          ))}
          {query && (
            <span className="chip chip--neutral">
              Matching “{query}”
              <button type="button" className="link-button" onClick={() => setParam('q', null)}>
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      <RecordTable
        className="queue-table"
        rows={shown}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={
          filter === 'mine' && open ? 'Nothing is waiting on you. See everyone’s invoices to pick one up.' : 'No invoices here.'
        }
        columns={[
          caseNumberColumn,
          {
            header: 'Client',
            render: (invoice) => (
              <>
                {invoice.caseClientDisplayName ?? '—'}
                <FlagNotes invoice={invoice} />
              </>
            ),
          },
          { header: 'From', render: (invoice) => <FromCell invoice={invoice} /> },
          { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—') },
          { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
          { header: 'Decided', render: (invoice) => `${invoice.decidedCount} of ${invoice.lineCount}` },
          open
            ? {
                header: 'Who has it',
                render: (invoice) =>
                  invoice.holder ? (
                    <>
                      {invoice.holder.displayName}
                      {invoice.statusCode === 'awaiting_sign_off' && <span className="cell-note">To sign off</span>}
                    </>
                  ) : (
                    <span className="muted">Not assigned</span>
                  ),
              }
            : { header: 'Status', render: (invoice) => <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /> },
          ...(open
            ? [
                {
                  header: 'Working days',
                  className: (invoice: ReviewQueueItem) => (isLate(invoice) ? 'late' : undefined),
                  render: (invoice: ReviewQueueItem) => `${invoice.workingDaysWaiting} ${invoice.workingDaysWaiting === 1 ? 'day' : 'days'}`,
                },
              ]
            : []),
          openInvoiceColumn(() => (open ? 'Review' : 'View')),
        ]}
      />
    </div>
  );
}
