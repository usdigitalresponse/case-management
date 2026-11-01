// The landing page: every invoice waiting for a decision, led by the person
// who sent it, with the case number as typed.
import { useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { listInvoiceIntake, listReviewQueue, type ReviewQueueItem } from '../api/client';
import { checkLinesPath } from '../portal/InvoiceSubmission';
import { INTAKE_PATH } from '../portal/useShell';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { CaseNumberCell, FlagNotes, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { AssignReviewer } from '../components/ReviewRouting';
import { Toast, useToast } from '../components/Toast';
import { QUEUE_FILTERS, matchesQueueFilter, type QueueFilterId } from '../queueFilters';
import { formatDate, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';

const SORTS = [
  { id: 'waiting', label: 'Waiting longest first' },
  { id: 'newest', label: 'Newest first' },
  { id: 'amount', label: 'Largest amount first' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

// 'waiting' keeps the server's order.
function sorted(rows: ReviewQueueItem[], sort: SortId): ReviewQueueItem[] {
  if (sort === 'newest') {
    return [...rows].sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
  }
  if (sort === 'amount') {
    return [...rows].sort((a, b) => Number(b.submittedTotal) - Number(a.submittedTotal));
  }
  return rows;
}

// This staff member's unsent drafts, and, since Intake is off the sidebar,
// anything held there.
function YourDrafts({ userAccountId }: { userAccountId: string }) {
  const { data } = useApiResource(() => listInvoiceIntake().then((result) => result.items).catch(() => []), []);
  const drafts = (data ?? []).filter((item) => item.invoiceId && item.stage !== 'sent' && item.enteredByUserAccountId === userAccountId);
  const held = (data ?? []).filter((item) => item.stage === 'sent');
  return (
    <>
      {held.length > 0 && (
        <Notice tone="warning">
          {held.length} {held.length === 1 ? 'invoice waits' : 'invoices wait'} on <RouterLink to={INTAKE_PATH}>Intake</RouterLink> to be
          matched.
        </Notice>
      )}
      {drafts.length > 0 && (
        <section className="your-drafts" aria-labelledby="your-drafts-heading">
          <h2 id="your-drafts-heading">Your drafts, not sent yet</h2>
          <ul>
            {drafts.map((item) => (
              <li key={item.invoiceId}>
                <span>
                  {item.professionalDisplayName ?? 'Who it is from not chosen'}
                  <span className="cell-note">
                    {formatPeriod(item.periodStart, item.periodEnd)}
                    {item.submittedTotal !== null && `, ${formatMoney(item.submittedTotal)}`}
                    {item.fileName && `, ${item.fileName}`}
                  </span>
                </span>
                <RouterLink className="row-action" to={checkLinesPath(item.invoiceId!, true)}>
                  Check the lines <span aria-hidden="true">→</span>
                </RouterLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function InvoicesToReview() {
  const { user } = useAuth();
  const userAccountId = user?.userAccountId ?? '';
  const [params, setParams] = useSearchParams();
  const filter = (params.get('show') as QueueFilterId | null) ?? 'everyone';
  const [sort, setSort] = useState<SortId>('waiting');
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => listReviewQueue('open'), [version]);
  const [toast, setToast] = useToast();
  const canAssign = Boolean(user?.reviewPermissions?.reassign);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        QUEUE_FILTERS.map(({ id }) => [id, data?.invoices.filter((invoice) => matchesQueueFilter(invoice, id, userAccountId)).length ?? 0]),
      ) as Record<QueueFilterId, number>,
    [data, userAccountId],
  );

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }

  const isLate = (invoice: ReviewQueueItem) => invoice.workingDaysWaiting > data.waitingAlertWorkingDays;
  const late = data.invoices.filter(isLate);
  const shown = sorted(
    data.invoices.filter((invoice) => matchesQueueFilter(invoice, filter, userAccountId)),
    sort,
  );

  return (
    <div>
      <PageHeader
        title="Invoices to review"
        description="Every invoice waiting for a decision. Each one belongs to the person who sent it. Case numbers are as they typed them."
        actions={
          <label className="sort-select">
            <span>Sort</span>
            <select className="usa-select" value={sort} onChange={(event) => setSort(event.target.value as SortId)}>
              {SORTS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <YourDrafts userAccountId={userAccountId} />

      {late.length > 0 && (
        <Notice
          tone="warning"
          heading={`${late.length} ${late.length === 1 ? 'invoice has' : 'invoices have'} waited more than ${data.waitingAlertWorkingDays} working days.`}
        >
          {late
            .map(
              (invoice) =>
                `${submittedByLabel(invoice)}, ${formatMoney(invoice.submittedTotal)}, ${
                  invoice.holder ? `with ${invoice.holder.displayName}` : 'not assigned'
                } for ${invoice.workingDaysWaiting} working days`,
            )
            .join('. ')}
          .
        </Notice>
      )}

      <div className="chip-filters" role="group" aria-label="Show">
        {QUEUE_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`chip chip--filter${id === 'flagged' ? ' chip--warning' : ''}`}
            aria-pressed={filter === id}
            onClick={() => setParams({ show: id })}
          >
            {label} <span className="chip-count">{counts[id]}</span>
          </button>
        ))}
      </div>

      <RecordTable
        className="queue-table"
        rows={shown}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={filter === 'mine' ? 'Nothing is waiting on you. See everyone’s invoices to pick one up.' : 'No invoices here.'}
        columns={[
          {
            header: 'From',
            rowHeader: true,
            render: (invoice) => (
              <>
                <FromCell invoice={invoice} />
                <FlagNotes invoice={invoice} />
              </>
            ),
          },
          { header: 'Case number, as typed', className: 'case-number-cell', render: (invoice) => <CaseNumberCell invoice={invoice} /> },
          { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—') },
          { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
          { header: 'Decided', render: (invoice) => `${invoice.decidedCount} of ${invoice.lineCount}` },
          {
            header: 'Reviewer',
            render: (invoice) =>
              invoice.holder ? (
                <>
                  {invoice.holder.displayName}
                  {invoice.statusCode === 'awaiting_sign_off' && <span className="cell-note">To sign off</span>}
                </>
              ) : (
                <>
                  <span className="muted">Not assigned</span>
                  {canAssign && (
                    <span className="cell-note">
                      <AssignReviewer
                        invoiceId={invoice.invoiceId}
                        onAssigned={(name) => {
                          setToast({ message: `Given to ${name}.` });
                          setVersion((v) => v + 1);
                        }}
                      />
                    </span>
                  )}
                </>
              ),
          },
          {
            header: 'Working days',
            className: (invoice) => (isLate(invoice) ? 'late' : undefined),
            render: (invoice) => `${invoice.workingDaysWaiting} ${invoice.workingDaysWaiting === 1 ? 'day' : 'days'}`,
          },
          openInvoiceColumn(() => 'Review'),
        ]}
      />
      <Toast toast={toast} />
    </div>
  );
}
