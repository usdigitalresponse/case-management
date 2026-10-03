import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { ApiError, getInvoiceForReview, type InvoiceReviewLine } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { RecordTable } from '../components/RecordTable';
import { InvoiceLineReviewActions } from '../components/InvoiceLineReviewActions';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDateTime } from '../formatDateTime';

function LineDecision({ line }: { line: InvoiceReviewLine }) {
  if (!line.decisionOutcomeCode) {
    return <>Not reviewed</>;
  }
  return (
    <div className="invoice-line-decision">
      <span className="status-pill">{line.decisionOutcomeDisplayName}</span>
      {line.decisionApprovedAmount && <span>${line.decisionApprovedAmount}</span>}
      {line.decisionReason && <span>{line.decisionReason}</span>}
      <span className="invoice-line-decided-by">
        {line.decidedByDisplayName ?? 'Unknown'}
        {line.decidedAt && `, ${formatDateTime(line.decidedAt)}`}
      </span>
    </div>
  );
}

export default function InvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { data: loaded, error } = useApiResource(() => getInvoiceForReview(invoiceId as string), [invoiceId]);
  // Refreshed in place after each decision, so other lines' unsaved
  // inputs aren't unmounted by a loading state.
  const [refreshed, setRefreshed] = useState<Awaited<ReturnType<typeof getInvoiceForReview>> | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const data = refreshed?.invoice.invoiceId === invoiceId ? refreshed : loaded;

  function refresh() {
    setRefreshFailed(false);
    getInvoiceForReview(invoiceId as string).then(setRefreshed, () => setRefreshFailed(true));
  }

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Invoice not found.' : 'Failed to load invoice.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!data) {
    return <p role="status">Loading invoice…</p>;
  }

  const { invoice, lines } = data;
  const reviewable = invoice.statusCode === 'submitted';
  const decidedCount = lines.filter((line) => line.decisionOutcomeCode).length;
  const approvedCents = lines.reduce((sum, line) => sum + Math.round(Number(line.decisionApprovedAmount ?? 0) * 100), 0);

  return (
    <div>
      <RouterLink to="/billing">&larr; Back to billing queue</RouterLink>
      <PageHeading
        eyebrow="Invoice review"
        title={caseDisplayLabel([invoice.caseClientDisplayName, invoice.caseExternalReference], undefined)}
        description={invoice.invoiceId}
      />

      <dl className="fact-grid">
        <div className="fact">
          <dt>Status</dt>
          <dd><span className="status-pill">{invoice.statusDisplayName}</span></dd>
        </div>
        <div className="fact">
          <dt>Submitted by</dt>
          <dd>{invoice.professionalDisplayName ?? 'Unknown'}</dd>
        </div>
        <div className="fact">
          <dt>Submitted</dt>
          <dd>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : '—'}</dd>
        </div>
        <div className="fact">
          <dt>Period</dt>
          <dd>{invoice.periodStart || invoice.periodEnd ? `${invoice.periodStart ?? '—'} to ${invoice.periodEnd ?? '—'}` : '—'}</dd>
        </div>
        <div className="fact">
          <dt>Requested total</dt>
          <dd>${invoice.submittedTotal}</dd>
        </div>
        <div className="fact">
          <dt>Approved so far</dt>
          <dd>${(approvedCents / 100).toFixed(2)}</dd>
        </div>
        <div className="fact">
          <dt>Lines reviewed</dt>
          <dd>{decidedCount} of {lines.length}</dd>
        </div>
      </dl>

      <p>
        <RouterLink to={`/cases/${invoice.caseId}`}>View case</RouterLink>
      </p>

      <div className="detail-section">
        <h2>Lines</h2>
        {refreshFailed && <Alert type="warning" slim>Decision saved, but the page failed to refresh. Reload to see it.</Alert>}
        <RecordTable
          rows={lines}
          rowKey={(line) => line.invoiceLineId}
          emptyMessage="This invoice has no lines."
          columns={[
            { header: 'Date', render: (l) => l.sourceActivityOn ?? '—' },
            { header: 'Hours', render: (l) => l.sourceDurationHours ?? '—' },
            { header: 'Description', render: (l) => l.sourceDescription ?? 'No linked time entry' },
            { header: 'Requested', render: (l) => `$${l.amount}` },
            {
              header: 'Review',
              render: (l) =>
                l.decisionOutcomeCode || !reviewable ? (
                  <LineDecision line={l} />
                ) : (
                  <InvoiceLineReviewActions
                    invoiceId={invoice.invoiceId}
                    invoiceLineId={l.invoiceLineId}
                    requestedAmount={l.amount}
                    onReviewed={refresh}
                  />
                ),
            },
          ]}
        />
      </div>
    </div>
  );
}
