import { useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { apiErrorMessage, listMyInvoices, transitionInvoice, type InvoiceRecord } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../AuthContext';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { StatusPill } from '../components/StatusPill';
import { Toast, useToast } from '../components/Toast';
import { formatMoney } from '../formatMoney';
import { WithdrawDialog } from './WithdrawDialog';
import { formatDayShort, formatSpan, submissionStatus } from './portalWording';
import { UPLOAD_PATH } from './useShell';

// Set by the upload page after several files go up as drafts.
export interface UploadedState {
  uploadedCount?: number;
}

function RowActions({
  invoice,
  canWithdraw,
  onWithdraw,
}: {
  invoice: InvoiceRecord;
  canWithdraw: boolean;
  onWithdraw: () => void;
}) {
  const detail = `/portal/invoices/${invoice.invoiceId}`;
  if (invoice.statusCode === 'draft') {
    const untouched = submissionStatus(invoice).note === 'Lines not checked yet.';
    return (
      <RouterLink className="row-action" to={detail}>
        {untouched ? 'Check the lines' : 'Continue checking'} <span aria-hidden="true">→</span>
      </RouterLink>
    );
  }
  if (invoice.statusCode === 'approved' || invoice.statusCode === 'rejected') {
    return <RouterLink className="row-action" to={detail}>See the decisions</RouterLink>;
  }
  return (
    <span className="row-actions">
      <RouterLink className="row-action" to={detail}>View</RouterLink>
      {canWithdraw && (
        <button type="button" className="link-button link-button--danger" onClick={onWithdraw}>
          Withdraw
        </button>
      )}
    </span>
  );
}

// The submitter's drafts and sent invoices in one list, drafts first.
export default function PortalInvoiceList() {
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => listMyInvoices().then((result) => result.invoices), [version]);
  const { user } = useAuth();
  const uploadedCount = (useLocation().state as UploadedState | null)?.uploadedCount ?? 0;
  const [withdrawing, setWithdrawing] = useState<InvoiceRecord | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  if (error || !data) {
    return <LoadState error={error} what="your invoices" />;
  }
  const rows = data.filter((invoice) => invoice.statusCode !== 'withdrawn');
  // Withdrawing is recall: only the sender, and only before review starts.
  const canWithdraw = (invoice: InvoiceRecord) =>
    invoice.statusCode === 'submitted' && invoice.submittedByUserAccountId === user?.userAccountId;

  async function withdraw(invoice: InvoiceRecord) {
    setWithdrawError(null);
    try {
      await transitionInvoice(invoice.invoiceId, 'recall');
      setWithdrawing(null);
      setToast({ message: 'Invoice withdrawn. It is back in your drafts.' });
      setVersion((v) => v + 1);
    } catch (err) {
      setWithdrawError(apiErrorMessage(err, 'The invoice could not be withdrawn.'));
    }
  }

  return (
    <div className="portal-content">
      <div className="portal-title-row">
        <div>
          <h1>Your invoices</h1>
          <p className="page-description">Invoices you have sent for review, and drafts you have not sent yet.</p>
        </div>
        <RouterLink className="btn btn--primary" to={UPLOAD_PATH}>Upload invoices</RouterLink>
      </div>
      {uploadedCount > 1 && (
        <Notice tone="info" heading={`${uploadedCount} invoices uploaded and saved as drafts.`}>
          Choose one to check its lines. Nothing is sent for review until you send each one.
        </Notice>
      )}
      <RecordTable
        label="Your invoices"
        className="portal-invoices"
        rows={rows}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage="No invoices yet. Upload one to get started."
        columns={[
          // No set widths: each column fits its content, so the actions never clip.
          {
            header: 'Case number',
            rowHeader: true,
            render: (invoice) => <strong>{invoice.caseNumber ?? invoice.caseExternalReference ?? '—'}</strong>,
          },
          { header: 'Client', render: (invoice) => invoice.caseClientDisplayName ?? '—' },
          { header: 'Billing period', render: (invoice) => formatSpan(invoice.periodStart, invoice.periodEnd) },
          {
            header: 'Sent',
            render: (invoice) =>
              invoice.submittedAt ? formatDayShort(invoice.submittedAt) : <span className="muted">Not sent</span>,
          },
          { header: 'Amount', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
          {
            header: 'Status',
            className: 'portal-invoices__status',
            render: (invoice) => {
              const status = submissionStatus(invoice);
              return (
                <>
                  <StatusPill tone={status.tone} label={status.label} />
                  {status.note && <span className="cell-note">{status.note}</span>}
                </>
              );
            },
          },
          {
            header: 'Actions',
            align: 'right',
            hiddenHeader: true,
            className: 'portal-invoices__actions',
            render: (invoice) => (
              <RowActions invoice={invoice} canWithdraw={canWithdraw(invoice)} onWithdraw={() => setWithdrawing(invoice)} />
            ),
          },
        ]}
      />
      <p className="compact-hint">You can withdraw an invoice until review starts. It then comes back here as a draft.</p>
      {withdrawing && (
        <WithdrawDialog
          error={withdrawError}
          onWithdraw={() => withdraw(withdrawing)}
          onClose={() => {
            setWithdrawing(null);
            setWithdrawError(null);
          }}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
