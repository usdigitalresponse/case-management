import { Link as RouterLink } from 'react-router';
import { listMyInvoices } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { MyInvoicesTable } from './MyInvoicesTable';
import { NEW_INVOICE_PATH } from './useShell';

// The submitter's invoices across cases, newest first, with drafts to
// finish at the top.
export default function PortalInvoiceList() {
  const { data, error } = useApiResource(() => listMyInvoices().then((result) => result.invoices), []);
  if (error || !data) {
    return <LoadState error={error} what="your invoices" />;
  }
  const drafts = data.filter((invoice) => invoice.statusCode === 'draft');
  const rest = data.filter((invoice) => invoice.statusCode !== 'draft' && invoice.statusCode !== 'withdrawn');

  return (
    <div>
      <PageHeader
        title="Your invoices"
        description="Invoices you submitted or that bill your work. Reviewers' decisions and notes show on each one."
        actions={<RouterLink className="btn btn--primary" to={NEW_INVOICE_PATH}>New invoice</RouterLink>}
      />
      {drafts.length > 0 && (
        <section className="detail-section">
          <h2>Drafts to finish</h2>
          <MyInvoicesTable rows={drafts} label="Drafts" />
        </section>
      )}
      <section className="detail-section">
        <h2>Submitted</h2>
        <MyInvoicesTable rows={rest} label="Submitted invoices" emptyMessage="Nothing submitted yet. Start one under New invoice." />
      </section>
    </div>
  );
}
