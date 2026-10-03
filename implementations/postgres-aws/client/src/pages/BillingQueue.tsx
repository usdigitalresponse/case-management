import { Link as RouterLink } from 'react-router-dom';
import { listInvoices, type QueuedInvoice } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { ResourceList } from '../components/ResourceList';
import { RecordTable } from '../components/RecordTable';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDateTime } from '../formatDateTime';

// Submitted invoices across all cases; each is reviewed line by line in
// ./InvoiceReview.tsx.
export default function BillingQueue() {
  const { data, error } = useApiResource(() => listInvoices('submitted').then((r) => r.invoices), []);

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
            { header: 'Review', render: (i) => <RouterLink to={`/billing/${i.invoiceId}`}>Review lines</RouterLink> },
          ]}
        />
      )}
    </ResourceList>
  );
}
