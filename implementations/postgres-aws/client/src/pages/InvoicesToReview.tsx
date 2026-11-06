// The landing page: every invoice waiting for a decision, led by the person
// who sent it, with the case number as typed.
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { apiErrorMessage, enterInReview, listInvoiceIntake, listReviewQueue, type ReviewQueueItem } from '../api/client';
import { reviewPath } from '../staffPaths';
import { checkLinesPath } from '../portal/InvoiceSubmission';
import { INTAKE_PATH } from '../portal/useShell';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { RecordTable } from '../components/RecordTable';
import { CaseNumberCell, countyOfInvoice, FlagNotes, FromCell, openInvoiceColumn, QuestionChips } from '../components/InvoiceCells';
import { useCountyControl } from '../components/CountyListControl';
import { AssignReviewer } from '../components/ReviewRouting';
import { Toast, useToast } from '../components/Toast';
import { QUEUE_FILTERS, matchesQueueFilter, type QueueFilterId } from '../queueFilters';
import { formatDate, formatDateTime, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';

const SORTS = [
  { id: 'waiting', label: 'Waiting longest first' },
  { id: 'newest', label: 'Newest first' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

// 'waiting' keeps the server's order.
function sorted(rows: ReviewQueueItem[], sort: SortId): ReviewQueueItem[] {
  if (sort === 'newest') {
    return [...rows].sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
  }
  return rows;
}

// This staff member's unfinished work, and, since Intake is off the sidebar,
// anything held there. For a reviewer: invoices they're still entering, and
// any draft from before uploads went straight into review, continued the
// same way. For other staff: their unsent drafts.
function YourUnfinished({ userAccountId, entering }: { userAccountId: string; entering: ReviewQueueItem[] }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reviews = Boolean(user?.reviewPermissions?.reviewLines);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { data } = useApiResource(() => listInvoiceIntake().then((result) => result.items).catch(() => []), [version]);
  const drafts = (data ?? []).filter((item) => item.invoiceId && item.stage !== 'sent' && item.enteredByUserAccountId === userAccountId);
  const held = (data ?? []).filter((item) => item.stage === 'sent');

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
      Continue <span aria-hidden="true">→</span>
    </>
  );
  return (
    <>
      {held.length > 0 && (
        <Notice tone="warning">
          {held.length} {held.length === 1 ? 'invoice waits' : 'invoices wait'} on <RouterLink to={INTAKE_PATH}>Intake</RouterLink> to be
          matched.
        </Notice>
      )}
      {(drafts.length > 0 || (reviews && entering.length > 0)) && (
        <section className="your-drafts" aria-labelledby="your-drafts-heading">
          <h2 id="your-drafts-heading">{reviews ? 'Your unfinished invoices' : 'Your drafts, not sent yet'}</h2>
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
                  </span>
                </li>
              ))}
            {drafts.map((item) => (
              <li key={item.invoiceId}>
                <span>
                  {item.professionalDisplayName ?? 'Who it is from not chosen'}
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
                  <DeleteInvoiceButton compact invoiceId={item.invoiceId!} onDeleted={() => setVersion((v) => v + 1)} />
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

  const county = useCountyControl(
    sorted((data?.invoices ?? []).filter((invoice) => matchesQueueFilter(invoice, filter, userAccountId)), sort),
    countyOfInvoice,
  );

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }

  const isLate = (invoice: ReviewQueueItem) => invoice.workingDaysWaiting > data.waitingAlertWorkingDays;
  const late = data.invoices.filter(isLate);
  const shown = county.shown;

  return (
    <div>
      <PageHeader
        title="Invoices to review"
        description="Every invoice waiting for a decision. Each one belongs to the person who sent it. Case numbers are as they typed them."
        actions={
          <>
            {county.control}
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
          </>
        }
      />

      <YourUnfinished
        userAccountId={userAccountId}
        entering={data.invoices.filter((invoice) => invoice.beingEntered && invoice.reviewer?.userAccountId === userAccountId)}
      />

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
