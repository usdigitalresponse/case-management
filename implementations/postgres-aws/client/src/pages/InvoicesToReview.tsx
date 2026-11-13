// The landing page: every invoice waiting for a decision, led by the person
// who sent it, with the case number as typed.
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { apiErrorMessage, enterInReview, type ReviewQueueItem } from '../api/client';
import { reviewPath } from '../staffPaths';
import { checkLinesPath } from '../portal/checkQueue';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { queueShowOf, toReviewRequest, TO_REVIEW_SORTS, type ToReviewSortId } from '../queueRequests';
import { invoiceIntake, reviewQueue } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { RecordTable } from '../components/RecordTable';
import { CaseNumberCell, FlagNotes, FromCell, openInvoiceColumn, QuestionChips } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { AssignReviewer } from '../components/ReviewRouting';
import { Toast, useToast } from '../components/Toast';
import { QUEUE_FILTERS, type QueueFilterId } from '../queueFilters';
import { formatDateTime, formatPeriod, formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { FilterTag } from '../components/ui/Tag';

// This staff member's unfinished work. For a reviewer: invoices they're still entering, and
// any draft from before uploads went straight into review, continued the
// same way. For other staff: their unsent drafts.
function YourUnfinished({ userAccountId, entering, onDeletedEntry }: { userAccountId: string; entering: ReviewQueueItem[]; onDeletedEntry: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reviews = Boolean(user?.reviewPermissions?.reviewLines);
  const [error, setError] = useState<string | null>(null);
  const { data, reload } = useResource(invoiceIntake);
  const items = data?.items ?? [];
  const drafts = items.filter((item) => item.invoiceId && item.stage !== 'sent' && item.enteredByUserAccountId === userAccountId);
  const onDeleted = () => {
    void reload();
    onDeletedEntry();
  };

  // Who it is from must be chosen first; that is on the check page.
  async function continueDraft(invoiceId: string, hasSender: boolean) {
    setError(null);
    if (!hasSender) {
      navigate(checkLinesPath(invoiceId, true));
      return;
    }
    try {
      await enterInReview(invoiceId);
      navigate(reviewPath(invoiceId));
    } catch (err) {
      setError(apiErrorMessage(err, 'It could not be opened for review. Try again.'));
    }
  }

  const continueLink = (
    <>
      Check the lines <span aria-hidden="true">→</span>
    </>
  );
  return (
    <>
      {(drafts.length > 0 || (reviews && entering.length > 0)) && (
        <section className="your-drafts" aria-labelledby="your-drafts-heading">
          <h2 id="your-drafts-heading">Your unfinished drafts</h2>
          {error && <Notice tone="danger">{error}</Notice>}
          <ul>
            {reviews &&
              entering.map((invoice) => (
                <li key={invoice.invoiceId}>
                  <span>
                    {invoice.professionalDisplayName ?? 'Unknown sender'}
                    <span className="cell-note">
                      {formatPeriod(invoice.periodStart, invoice.periodEnd)}, {formatMoney(invoice.submittedTotal)}.{' '}
                      Being entered, {invoice.decidedCount} of {invoice.lineCount} lines decided
                      {invoice.linesChangedAt && `, last saved ${formatDateTime(invoice.linesChangedAt)}`}
                    </span>
                  </span>
                  <span className="row-actions">
                    <RouterLink className="row-action" to={reviewPath(invoice.invoiceId)}>
                      {continueLink}
                    </RouterLink>
                    {invoice.discardable && (
                      <DeleteInvoiceButton compact invoiceId={invoice.invoiceId} onDeleted={onDeleted} />
                    )}
                  </span>
                </li>
              ))}
            {drafts.map((item) => (
              <li key={item.invoiceId}>
                <span>
                  {item.professionalDisplayName ?? 'Who billed it isn’t chosen'}
                  <span className="cell-note">
                    {formatPeriod(item.periodStart, item.periodEnd)}
                    {item.submittedTotal !== null && `, ${formatMoney(item.submittedTotal)}`}
                    {item.fileName && `, ${item.fileName}`}
                    {reviews && '. Not started'}
                  </span>
                </span>
                <span className="row-actions">
                  {reviews ? (
                    <button
                      type="button"
                      className="link-button row-action"
                      onClick={() => void continueDraft(item.invoiceId!, Boolean(item.professionalId))}
                    >
                      {continueLink}
                    </button>
                  ) : (
                    <RouterLink className="row-action" to={checkLinesPath(item.invoiceId!, true)}>
                      Check the lines <span aria-hidden="true">→</span>
                    </RouterLink>
                  )}
                  {/* Your own drafts, never sent, so always deletable. */}
                  <DeleteInvoiceButton compact invoiceId={item.invoiceId!} onDeleted={onDeleted} />
                </span>
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
  const [params] = useSearchParams();
  const [filter, setFilter] = useSearchParamState<QueueFilterId>('show', 'everyone', QUEUE_FILTERS.map(({ id }) => id));
  const [sort, setSort] = useSearchParamState<ToReviewSortId>('sort', 'waiting', TO_REVIEW_SORTS.map((option) => option.id));
  const list = useBatchedResource(reviewQueue(toReviewRequest(params)));
  const { summary, reload } = list;
  const [toast, setToast] = useToast();
  const canAssign = Boolean(user?.reviewPermissions?.reassign);
  const county = useCountyControl(summary?.counties ?? null);

  if (list.error || !list.items || !summary) {
    return <LoadState error={list.error} what="invoices" />;
  }

  const isLate = (invoice: { workingDaysWaiting: number }) => invoice.workingDaysWaiting > summary.waitingAlertWorkingDays;
  const { late } = summary;

  return (
    <div>
      <PageHeader
        list
        title="Invoices to review"
        description="Every invoice waiting for a decision. Each one belongs to the person who sent it. Case numbers are as they typed them."
        actions={
          <>
            {county.control}
            <label className="sort-select">
              <span>Sort</span>
              <select className="usa-select" value={sort} onChange={(event) => setSort(event.target.value as ToReviewSortId)}>
                {TO_REVIEW_SORTS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />

      <YourUnfinished userAccountId={userAccountId} entering={summary.entering} onDeletedEntry={() => void reload()} />

      {late.length > 0 && (
        <Notice tone="warning">
          {`${late.length} ${late.length === 1 ? 'invoice has' : 'invoices have'} waited more than ${summary.waitingAlertWorkingDays} working days. `}
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

      <div className="tag-filters" role="group" aria-label="Show">
        {QUEUE_FILTERS.map(({ id, label }) => (
          <FilterTag
            key={id}
            tone={id === 'flagged' ? 'warning' : undefined}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
            {summary.counts[queueShowOf(id)] !== null && <span className="tag-count">{summary.counts[queueShowOf(id)]}</span>}
          </FilterTag>
        ))}
      </div>

      <RecordTable
        className="queue-table"
        rows={list.items}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={county.narrowed ? 'No invoices here for that county.' : filter === 'mine' ? 'Nothing is waiting on you. See everyone’s invoices to pick one up.' : 'No invoices here.'}
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
          { header: 'Case number', className: 'case-number-cell', render: (invoice) => <CaseNumberCell invoice={invoice} /> },
          { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDay(invoice.submittedAt) : '—') },
          { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
          { header: 'Decided', render: (invoice) => `${invoice.decidedCount} of ${invoice.lineCount}` },
          {
            header: 'Reviewer',
            render: (invoice) =>
              invoice.holder ? (
                <>
                  {invoice.holder.displayName}
                  {invoice.statusCode === 'awaiting_sign_off' && <span className="cell-note">To sign off</span>}
                  <QuestionChips invoice={invoice} />
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
                          void reload();
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
      <MoreOnScroll list={list} what="invoices" />
      <Toast toast={toast} />
    </div>
  );
}
