import { useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { apiErrorMessage, transitionInvoice, type InvoiceRecord } from '../api/client';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { myInvoices as myInvoiceList } from '../resources';
import { useAuth } from '../AuthContext';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Notice } from '../components/ui/Notice';
import { RecordTable, type RecordTableColumn } from '../components/RecordTable';
import { EnteredFlag } from '../components/NewEntryFields';
import { StatusPill } from '../components/StatusPill';
import { Toast, useToast } from '../components/Toast';
import { formatMoney } from '../formatMoney';
import { WithdrawDialog } from './WithdrawDialog';
import { canWithdraw, formatDayShort, formatSpan, submissionStatus } from './portalWording';
import { UPLOAD_PATH } from './useShell';
import { listCaseNumber } from './invoiceListView';
import { buttonClass } from '../components/ui/Button';

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
      <RouterLink className="row-action" to={detail}>Open</RouterLink>
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

// The submitter's drafts and sent invoices, drafts first, a batch at a time.
// No search or filters: the list is one person's.
export default function PortalInvoiceList() {
  const list = useBatchedResource(myInvoiceList());
  const { summary, reload } = list;
  const { user } = useAuth();
  const uploadedCount = (useLocation().state as UploadedState | null)?.uploadedCount ?? 0;
  const [withdrawing, setWithdrawing] = useState<InvoiceRecord | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  if (list.error || !list.items || !summary) {
    return <LoadState error={list.error} what="your invoices" />;
  }
  // Sent back by the billing office: first, until they're sent again.
  const { needsChanges } = summary;
  const others = list.items;

  async function withdraw(invoice: InvoiceRecord) {
    setWithdrawError(null);
    try {
      await transitionInvoice(invoice.invoiceId, 'recall');
      setWithdrawing(null);
      setToast({ message: 'Invoice withdrawn. It is back in your drafts.' });
      void reload();
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
      <PageHeader
        list
        title="Your invoices"
        description="Every invoice you have sent for review, and drafts you have not sent yet. Each one shows its case number."
        actions={<RouterLink className={buttonClass('primary')} to={UPLOAD_PATH}>Upload invoices</RouterLink>}
      />
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
      <MoreOnScroll list={list} what="invoices" />
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
