import { useSearchParams } from 'react-router';
import { type ReviewQueueItem } from '../api/client';
import { useAuth } from '../AuthContext';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { alternateRequest, queueShowOf } from '../queueRequests';
import { submittedByLabel } from '../reviewTotals';
import { reviewQueue } from '../resources';
import { InvoiceStatus } from '../components/Completion';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { RecordTable } from '../components/RecordTable';
import { caseNumberColumn, FlagNotes, FromCell, openInvoiceColumn, QuestionChips } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { AssignReviewer } from '../components/ReviewRouting';
import { Toast, useToast } from '../components/Toast';
import { QUEUE_FILTERS, type QueueFilterId } from '../queueFilters';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { Tag } from '../components/ui/Tag';
import { FilterTag } from '../components/ui/Tag';

const FILTERS = QUEUE_FILTERS;
type FilterId = QueueFilterId;

// The first screen: invoices waiting for a decision, who has each and how
// long it has waited (working days), so nothing quietly stalls.
export default function ReviewQueue({ view }: { view: 'open' | 'finished' }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const filter: FilterId = view === 'open' ? (FILTERS.find(({ id }) => id === params.get('show'))?.id ?? 'mine') : 'everyone';
  const query = params.get('q') ?? '';
  const list = useBatchedResource(reviewQueue(alternateRequest(view, params)));
  const { summary, reload } = list;
  const [toast, setToast] = useToast();
  const canAssign = Boolean(user?.reviewPermissions?.reassign);
  const county = useCountyControl(summary?.counties ?? null);

  if (list.error || !list.items || !summary) {
    return <LoadState error={list.error} what="invoices" />;
  }

  const open = view === 'open';
  const isLate = (invoice: { workingDaysWaiting: number }) => invoice.workingDaysWaiting > summary.waitingAlertWorkingDays;
  const late = open ? summary.late : [];
  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { preventScrollReset: true });
  };

  return (
    <div>
      <PageHeader
        list
        title={open ? 'Invoices to review' : 'Finished invoices'}
        description={
          open ? 'Every invoice waiting for a decision, longest wait first.' : 'Invoices signed off or rejected. Export them from the invoice.'
        }
      />

      {late.length > 0 && (
        <Notice
          tone="warning"
          heading={`${late.length} ${late.length === 1 ? 'invoice has' : 'invoices have'} waited more than ${summary.waitingAlertWorkingDays} working days.`}
        >
          {late
            .map(
              (invoice) =>
                `${submittedByLabel(invoice)}, ${formatMoney(invoice.submittedTotal)}, ${
                  invoice.holderDisplayName ? `with ${invoice.holderDisplayName}` : 'not assigned'
                } for ${invoice.workingDaysWaiting} working days`,
            )
            .join('. ')}
          .
        </Notice>
      )}

      <div className="list-controls">
        {open && (
          <div className="tag-filters" role="group" aria-label="Show">
            {FILTERS.map(({ id, label }) => (
              <FilterTag
                key={id}
                tone={id === 'flagged' ? 'warning' : undefined}
                aria-pressed={filter === id}
                onClick={() => setParam('show', id)}
              >
                {label}
                {summary.counts[queueShowOf(id)] !== null && <span className="tag-count">{summary.counts[queueShowOf(id)]}</span>}
              </FilterTag>
            ))}
            {query && (
              <Tag tone="neutral">
                Matching “{query}”
                <button type="button" className="link-button" onClick={() => setParam('q', null)}>
                  Clear
                </button>
              </Tag>
            )}
          </div>
        )}
        {county.control}
      </div>

      <RecordTable
        className="queue-table"
        rows={list.items}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={
          county.narrowed
            ? 'No invoices here for that county.'
            : filter === 'mine' && open
              ? 'Nothing is waiting on you. See everyone’s invoices to pick one up.' : 'No invoices here.'
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
          { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDay(invoice.submittedAt) : '—') },
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
                      <QuestionChips invoice={invoice} />
                    </>
                  ) : canAssign ? (
                    <AssignReviewer
                      invoiceId={invoice.invoiceId}
                      onAssigned={(name) => {
                        setToast({ message: `Given to ${name}.` });
                        void reload();
                      }}
                    />
                  ) : (
                    <span className="muted">Not assigned</span>
                  ),
              }
            : { header: 'Status', render: (invoice) => <InvoiceStatus invoice={invoice} onCompleted={reload} /> },
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
      <MoreOnScroll list={list} what="invoices" />
      <Toast toast={toast} />
    </div>
  );
}
