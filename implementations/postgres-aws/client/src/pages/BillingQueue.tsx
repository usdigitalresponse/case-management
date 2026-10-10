import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Label, Select } from '@trussworks/react-uswds';
import { listInvoices, type QueuedInvoice } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { ResourceList } from '../components/ResourceList';
import { RecordTable } from '../components/RecordTable';
import { StatusPill } from '../components/StatusPill';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

// Submitted invoices across all cases, by default those awaiting review.
const FILTERS = [
  { value: 'submitted', label: 'Awaiting review', empty: 'No invoices are waiting on review.' },
  { value: 'approved', label: 'Approved', empty: 'No approved invoices.' },
  { value: 'rejected', label: 'Rejected', empty: 'No rejected invoices.' },
  { value: '', label: 'All submitted', empty: 'No invoices have been submitted.' },
];

export default function BillingQueue() {
  const [status, setStatus] = useState('submitted');
  const filter = FILTERS.find((option) => option.value === status) ?? FILTERS[0]!;
  const { data, error } = useApiResource(() => listInvoices(status || undefined).then((r) => r.invoices), [status]);

  return (
    <ResourceList
      heading={
        <>
          <PageHeading eyebrow="Billing" title="Invoices" />
          <div className="queue-filter">
            <div>
              <Label htmlFor="invoice-status-filter">Show</Label>
              <Select
                id="invoice-status-filter"
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </>
      }
      error={error}
      data={data}
      errorMessage="Failed to load invoices."
      emptyMessage={filter.empty}
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
            {
              header: 'Professional',
              render: (i) => (
                <>
                  {i.professionalDisplayName ?? 'Unknown'}
                  {i.submittedByDisplayName && i.submittedByDisplayName !== i.professionalDisplayName && (
                    <span className="invoice-line-decided-by"> (submitted by {i.submittedByDisplayName})</span>
                  )}
                </>
              ),
            },
            { header: 'Submitted', render: (i) => (i.submittedAt ? formatDateTime(i.submittedAt) : '—') },
            { header: 'Total', render: (i) => <span className="amount">{formatMoney(i.submittedTotal)}</span> },
            { header: 'Status', render: (i) => <StatusPill code={i.statusCode} label={i.statusDisplayName} /> },
            {
              header: 'Actions',
              render: (i) => (
                <RouterLink to={`/billing/${i.invoiceId}`}>{i.statusCode === 'submitted' ? 'Review' : 'View'}</RouterLink>
              ),
            },
          ]}
        />
      )}
    </ResourceList>
  );
}
