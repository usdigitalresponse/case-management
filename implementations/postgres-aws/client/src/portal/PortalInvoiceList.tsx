import { Link as RouterLink } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import { listMyInvoices } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { StatusPill } from '../components/StatusPill';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

// The submitter's start page: their invoices across cases, newest first,
// with drafts to finish at the top.
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

  const table = (rows: typeof data, label: string) => (
    <div className="data-card">
      <table className="usa-table queue-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">For</th>
            <th scope="col">Submitted</th>
            <th scope="col" className="amount">Requested</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="usa-sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((invoice) => (
            <tr key={invoice.invoiceId}>
              <th scope="row">
                {invoice.caseClientDisplayName ?? 'Unknown client'}
                {invoice.caseExternalReference && <span className="cell-note">{invoice.caseExternalReference}</span>}
              </th>
              <td>{invoice.professionalDisplayName ?? '—'}</td>
              <td>{invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—'}</td>
              <td className="amount"><strong>{formatMoney(invoice.submittedTotal)}</strong></td>
              <td><StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /></td>
              <td>
                <RouterLink className="row-action" to={`/portal/invoices/${invoice.invoiceId}`}>
                  {invoice.statusCode === 'draft' ? 'Finish' : 'Open'} <span aria-hidden="true">→</span>
                </RouterLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h1>Your invoices</h1>
          <p className="page-description">Invoices you submitted or that bill your work. Reviewers' decisions and notes show on each one.</p>
        </div>
        <div className="title-actions">
          <RouterLink className="btn btn--primary" to="/portal/imports">Import invoices</RouterLink>
          <RouterLink className="btn btn--outline" to="/portal/cases">Your cases</RouterLink>
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
        {rest.length === 0 ? <p className="empty-note">Nothing submitted yet. Import an invoice or start one from a case.</p> : table(rest, 'Submitted invoices')}
      </section>
    </div>
  );
}
