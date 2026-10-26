import { Link as RouterLink } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import { listReviewQueue } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { InvoiceExportLinks } from '../components/InvoiceExportLinks';
import { formatMoney } from '../formatMoney';

// Signed-off invoices, ready to export for payment. Payment itself happens
// outside this system.
export default function Exports() {
  const { data, error } = useApiResource(() => listReviewQueue('finished'), []);
  if (error) {
    return <Alert type="error">Failed to load invoices.</Alert>;
  }
  if (!data) {
    return <p role="status">Loading invoices…</p>;
  }
  const signedOff = data.invoices.filter((invoice) => invoice.statusCode === 'approved');
  return (
    <div>
      <h1>Exports</h1>
      <p className="page-description">Signed-off invoices, with every decision and reason, to send for payment.</p>
      <div className="notice notice--info">
        Check each PDF or spreadsheet for confidential information before you send it. This system does not remove it.
      </div>
      {signedOff.length === 0 ? (
        <p className="empty-note">No invoices have been signed off yet.</p>
      ) : (
        <div className="data-card">
          <table className="usa-table queue-table">
            <thead>
              <tr>
                <th scope="col">Case number</th>
                <th scope="col">Client</th>
                <th scope="col">From</th>
                <th scope="col" className="amount">Requested</th>
                <th scope="col">Export</th>
              </tr>
            </thead>
            <tbody>
              {signedOff.map((invoice) => (
                <tr key={invoice.invoiceId}>
                  <th scope="row" className="case-number-cell">
                    <RouterLink to={`/billing/${invoice.invoiceId}`}>{invoice.caseNumber ?? 'Open invoice'}</RouterLink>
                  </th>
                  <td>{invoice.caseClientDisplayName ?? '—'}</td>
                  <td>{invoice.professionalDisplayName ?? '—'}</td>
                  <td className="amount">{formatMoney(invoice.submittedTotal)}</td>
                  <td><InvoiceExportLinks scope="staff" invoiceId={invoice.invoiceId} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
