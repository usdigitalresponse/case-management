import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { listInvoices, type QueuedInvoice } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { ResourceList } from '../components/ResourceList';
import { RecordTable } from '../components/RecordTable';
import { InvoiceReviewActions } from '../components/InvoiceReviewActions';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDateTime } from '../formatDateTime';

// The Billing stage's working queue: every submitted invoice, across all
// cases, waiting on a staff decision. Approving moves its case into the
// closing stage (server/src/cases/caseStage.ts); rejecting sends the
// invoice back to the vendor outside this system (there's no resubmission
// flow yet — see MAPPING.md).
export default function BillingQueue() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error } = useApiResource(() => listInvoices('submitted').then((r) => r.invoices), [refreshKey]);

  return (
    <ResourceList
      heading={<PageHeading eyebrow="Billing" title="Invoices awaiting review" />}
      error={error}
      data={data}
      errorMessage="Failed to load invoices."
      emptyMessage="No invoices are waiting on review."
    >
      {(invoices: QueuedInvoice[]) => (
        <RecordTable
          rows={invoices}
          rowKey={(i) => i.invoiceId}
          columns={[
            {
              header: 'Case',
              render: (i) => (
                <RouterLink to={`/cases/${i.caseId}`}>
                  {caseDisplayLabel([i.caseClientDisplayName, i.caseExternalReference], undefined)}
                </RouterLink>
              ),
            },
            { header: 'Submitted by', render: (i) => i.professionalDisplayName ?? 'Unknown' },
            { header: 'Submitted', render: (i) => (i.submittedAt ? formatDateTime(i.submittedAt) : '—') },
            { header: 'Total', render: (i) => `$${i.submittedTotal}` },
            {
              header: 'Review',
              render: (i) => <InvoiceReviewActions invoiceId={i.invoiceId} onReviewed={() => setRefreshKey((key) => key + 1)} />,
            },
          ]}
        />
      )}
    </ResourceList>
  );
}
