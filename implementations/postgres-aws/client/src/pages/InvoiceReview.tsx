import { useEffect, useRef, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { ApiError, getInvoiceForReview } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { RecordTable } from '../components/RecordTable';
import { InvoiceLineReviewActions } from '../components/InvoiceLineReviewActions';
import { InvoiceExportLinks } from '../components/InvoiceExportLinks';
import { InvoiceSummary, invoiceReference } from '../components/InvoiceSummary';
import { LineDecision } from '../components/LineDecision';
import { lineDate, lineDescription, lineHours, lineRate, lineTimekeeper, lineType } from '../invoiceLineDisplay';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatMoney } from '../formatMoney';

export default function InvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { data: loaded, error } = useApiResource(() => getInvoiceForReview(invoiceId as string), [invoiceId]);
  // Refreshed in place after each decision, so other lines' unsaved
  // inputs aren't unmounted by a loading state.
  const [refreshed, setRefreshed] = useState<Awaited<ReturnType<typeof getInvoiceForReview>> | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Only the latest request may apply, so a slow earlier refresh can't
  // overwrite newer decisions.
  const latestRequest = useRef(0);
  const data = refreshed?.invoice.invoiceId === invoiceId ? refreshed : loaded;

  useEffect(() => {
    latestRequest.current += 1;
    setRefreshed(null);
    setRefreshFailed(false);
  }, [invoiceId]);

  function refresh() {
    const request = ++latestRequest.current;
    setRefreshFailed(false);
    getInvoiceForReview(invoiceId as string).then(
      (result) => {
        if (request === latestRequest.current) setRefreshed(result);
      },
      () => {
        if (request === latestRequest.current) setRefreshFailed(true);
      },
    );
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

  return (
    <div>
      <RouterLink className="back-link" to="/billing">&larr; Back to invoices</RouterLink>
      <PageHeading
        eyebrow={reviewable ? 'Invoice review' : 'Invoice'}
        title={caseDisplayLabel([invoice.caseClientDisplayName, invoice.caseExternalReference], undefined)}
        description={invoiceReference(invoice.invoiceId)}
      />

      <InvoiceSummary invoice={invoice} lines={lines} showReviewProgress />

      <div className="invoice-actions">
        <InvoiceExportLinks scope="staff" invoiceId={invoice.invoiceId} />
        <RouterLink className="usa-button usa-button--unstyled" to={`/cases/${invoice.caseId}`}>View case</RouterLink>
      </div>

      <div className="detail-section">
        <h2>Invoice items</h2>
        {refreshFailed && <Alert type="warning" slim>Decision saved, but the page failed to refresh. Reload to see it.</Alert>}
        <RecordTable
          rows={lines}
          rowKey={(line) => line.invoiceLineId}
          emptyMessage="This invoice has no items."
          columns={[
            { header: 'Date', render: lineDate },
            { header: 'Type', render: lineType },
            { header: 'Description', render: lineDescription },
            { header: 'Timekeeper', render: lineTimekeeper },
            { header: 'Hours', render: lineHours },
            { header: 'Rate', render: (l) => <span className="amount">{lineRate(l)}</span> },
            { header: 'Requested', render: (l) => <span className="amount">{formatMoney(l.amount)}</span> },
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
