import { useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { apiErrorMessage, transitionInvoice, type InvoiceRecord } from '../api/client';
import { useResource } from '../hooks/useResource';
import { myInvoices as myInvoiceList } from '../resources';
import { useAuth } from '../AuthContext';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable, type RecordTableColumn } from '../components/RecordTable';
import { EnteredFlag } from '../components/NewEntryFields';
import { StatusPill } from '../components/StatusPill';
import { Toast, useToast } from '../components/Toast';
import { formatMoney } from '../formatMoney';
import { WithdrawDialog } from './WithdrawDialog';
import { canWithdraw, formatDayShort, formatSpan, submissionStatus } from './portalWording';
import { UPLOAD_PATH } from './useShell';
import { inListOrder, listCaseNumber } from './invoiceListView';

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

function StatusCell({ invoice }: { invoice: InvoiceRecord }) {
  const status = submissionStatus(invoice);
  const missing = invoice.statusCode === 'draft' && !listCaseNumber(invoice);
  const note = [status.note, missing ? 'No case number yet.' : null].filter(Boolean).join(' ');
  return (
    <>
      <StatusPill tone={status.tone} label={status.label} />
      {note && <span className={`cell-note${missing ? ' cell-note--warning' : ''}`}>{note}</span>}
    </>
  );
}

// The submitter's drafts and sent invoices, drafts first. No search or
// filters: the list is one person's.
export default function PortalInvoiceList() {
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(myInvoiceList, { resetKey: version });
  const { user } = useAuth();
  const uploadedCount = (useLocation().state as UploadedState | null)?.uploadedCount ?? 0;
  const [withdrawing, setWithdrawing] = useState<InvoiceRecord | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  if (error || !data) {
    return <LoadState error={error} what="your invoices" />;
  }
  const shown = inListOrder(data.filter((invoice) => invoice.statusCode !== 'withdrawn'));
  // Sent back by the billing office: first, until they're sent again.
  const needsChanges = shown.filter((invoice) => invoice.returnedReason);
  const others = shown.filter((invoice) => !invoice.returnedReason);

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

  const columns: Array<RecordTableColumn<InvoiceRecord>> = [
          // No set widths: each column fits its content, so the actions never clip.
          {
            header: 'Case number',
            rowHeader: true,
            render: (invoice) => {
              const number = listCaseNumber(invoice);
              if (!number) {
                return <span className="text-warning">{invoice.statusCode === 'draft' ? 'Not added yet' : '—'}</span>;
              }
              return (
                <>
                  <strong>{number}</strong>
                  {!invoice.caseId && !invoice.caseNumberAsTyped && invoice.proposedCase && <EnteredFlag what="Case" compact />}
                </>
              );
            },
          },
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
            render: (invoice) => <StatusCell invoice={invoice} />,
          },
          {
            header: 'Actions',
            align: 'right',
            hiddenHeader: true,
            className: 'portal-invoices__actions',
            render: (invoice) => (
              <RowActions invoice={invoice} canWithdraw={canWithdraw(invoice, user?.userAccountId)} onWithdraw={() => setWithdrawing(invoice)} />
            ),
          },
  ];

  return (
    <div className="portal-content">
      <div className="portal-title-row">
        <div>
          <h1>Your invoices</h1>
          <p className="page-description">
            Every invoice you have sent for review, and drafts you have not sent yet. Each one shows its case number.
          </p>
        </div>
        <RouterLink className="btn btn--primary" to={UPLOAD_PATH}>Upload invoices</RouterLink>
      </div>
      {uploadedCount > 1 && (
        <Notice tone="info" heading={`${uploadedCount} invoices uploaded and saved as drafts.`}>
          Choose one to check its lines. Nothing is sent for review until you send each one.
        </Notice>
      )}
      {needsChanges.length > 0 && (
        <section className="portal-needs-changes">
          <h2>Needs your changes</h2>
          <p className="compact-hint">The billing office sent these back. Make the changes they ask for, then send each one again.</p>
          <RecordTable label="Invoices that need your changes" className="portal-invoices" rows={needsChanges} rowKey={(invoice) => invoice.invoiceId} emptyMessage="" columns={columns} />
        </section>
      )}
      <RecordTable
        label="Your invoices"
        className="portal-invoices"
        rows={others}
        rowKey={(invoice) => invoice.invoiceId}
        emptyMessage={needsChanges.length > 0 ? 'Nothing else yet.' : 'No invoices yet. Upload one to get started.'}
        columns={columns}
      />
      <p className="compact-hint">
        Your invoices are filed under your name. You do not need to set up cases or clients here. You can withdraw an
        invoice until review starts; it then comes back here as a draft.
      </p>
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
