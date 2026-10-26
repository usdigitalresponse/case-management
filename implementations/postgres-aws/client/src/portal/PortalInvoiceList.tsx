import { Link as RouterLink } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import { listMyInvoices } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { StatusPill } from '../components/StatusPill';
import { RecordTable } from '../components/RecordTable';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

// The submitter's invoices across cases, newest first, with drafts to
// finish at the top.
export default function PortalInvoiceList() {
  const { data, error } = useApiResource(() => listMyInvoices().then((result) => result.invoices), []);
  if (error) {
    return <Alert type="error">Failed to load your invoices.</Alert>;
  }
  if (!data) {
    return <p role="status">Loading your invoices…</p>;
  }
  const drafts = data.filter((invoice) => invoice.statusCode === 'draft');
  const rest = data.filter((invoice) => invoice.statusCode !== 'draft' && invoice.statusCode !== 'withdrawn');

  // The drafts and submitted tables share widths, so their columns line up.
  const table = (rows: typeof data, label: string) => (
    <RecordTable
      label={label}
      className="queue-table"
      rows={rows}
      rowKey={(invoice) => invoice.invoiceId}
      columns={[
        {
          header: 'Client',
          width: '24%',
          rowHeader: true,
          render: (invoice) => (
            <>
              {invoice.caseClientDisplayName ?? 'Unknown client'}
              {invoice.caseExternalReference && <span className="cell-note">{invoice.caseExternalReference}</span>}
            </>
          ),
        },
        { header: 'For', width: '20%', render: (invoice) => invoice.professionalDisplayName ?? '—' },
        {
          header: 'Submitted',
          width: '16%',
          render: (invoice) => (invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : <span className="muted">Not yet</span>),
        },
        { header: 'Requested', width: '14%', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
        { header: 'Status', width: '14%', render: (invoice) => <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /> },
        {
          header: 'Open',
          width: '12%',
          align: 'right',
          hiddenHeader: true,
          render: (invoice) => (
            <RouterLink className="row-action" to={`/portal/invoices/${invoice.invoiceId}`}>
              {invoice.statusCode === 'draft' ? 'Finish' : 'Open'} <span aria-hidden="true">→</span>
            </RouterLink>
          ),
        },
      ]}
    />
  );

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h1>Your invoices</h1>
          <p className="page-description">Invoices you submitted or that bill your work. Reviewers' decisions and notes show on each one.</p>
        </div>
        <div className="title-actions">
          <RouterLink className="btn btn--primary" to="/">New invoice</RouterLink>
        </div>
      </div>
      {drafts.length > 0 && (
        <section className="detail-section">
          <h2>Drafts to finish</h2>
          {table(drafts, 'Drafts')}
        </section>
      )}
      <section className="detail-section">
        <h2>Submitted</h2>
        {rest.length === 0 ? <p className="empty-note">Nothing submitted yet. Start one under New invoice.</p> : table(rest, 'Submitted invoices')}
      </section>
    </div>
  );
}
