import { useState } from 'react';
import { Link as RouterLink, useLocation, useSearchParams } from 'react-router';
import { apiErrorMessage, listMyInvoices, transitionInvoice, type InvoiceRecord } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
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
import { SearchInput } from '../components/SearchInput';
import {
  INVOICE_FILTERS,
  INVOICE_SORTS,
  choiceFrom,
  invoiceView,
  matchesFilter,
  type InvoiceFilter,
  type InvoiceSort,
} from './invoiceListView';

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
  // In the address, so going back keeps them.
  const [params, setParams] = useSearchParams();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  if (error || !data) {
    return <LoadState error={error} what="your invoices" />;
  }
  const rows = data.filter((invoice) => invoice.statusCode !== 'withdrawn');
  const query = params.get('q') ?? '';
  const filter = choiceFrom(params.get('show'), INVOICE_FILTERS, 'all');
  const sort = choiceFrom(params.get('sort'), INVOICE_SORTS, 'recent');
  const narrowed = Boolean(query.trim()) || filter !== 'all';
  const setParam = (key: string, value: string, unset: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== unset) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const shown = invoiceView(rows, { query, filter, sort });
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
            render: (invoice) => <strong>{invoice.caseNumber ?? invoice.caseExternalReference ?? invoice.proposedCase?.caseNumber ?? '—'}</strong>,
          },
          {
            header: 'Client',
            render: (invoice) =>
              invoice.caseClientDisplayName ??
              (invoice.proposedCase ? (
                <>
                  {invoice.proposedCase.clientName} <EnteredFlag what="Case" compact />
                </>
              ) : (
                '—'
              )),
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
              <RowActions invoice={invoice} canWithdraw={canWithdraw(invoice, user?.userAccountId)} onWithdraw={() => setWithdrawing(invoice)} />
            ),
          },
  ];

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
      {rows.length > 0 && (
        <div className="queue-filter invoice-list-controls">
          <div className="invoice-list-controls__search">
            <label className="usa-label" htmlFor="invoice-search">Search</label>
            <SearchInput id="invoice-search" placeholder="Case number, client or provider" value={query} onChange={(value) => setParam('q', value, '')} />
          </div>
          <div>
            <label className="usa-label" htmlFor="invoice-show">Show</label>
            <select id="invoice-show" className="usa-select" value={filter} onChange={(event) => setParam('show', event.target.value, 'all')}>
              {(Object.entries(INVOICE_FILTERS) as Array<[InvoiceFilter, string]>).map(([key, label]) => (
                <option key={key} value={key}>
                  {label} ({rows.filter((invoice) => matchesFilter(invoice, key)).length})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="usa-label" htmlFor="invoice-sort">Sort by</label>
            <select id="invoice-sort" className="usa-select" value={sort} onChange={(event) => setParam('sort', event.target.value, 'recent')}>
              {(Object.entries(INVOICE_SORTS) as Array<[InvoiceSort, string]>).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          {narrowed && (
            <button type="button" className="link-button" onClick={() => setParams({}, { replace: true })}>
              Show all
            </button>
          )}
        </div>
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
        emptyMessage={
          narrowed
            ? needsChanges.length > 0
              ? 'No other invoices match.'
              : 'No invoices match.'
            : needsChanges.length > 0
              ? 'Nothing else yet.'
              : 'No invoices yet. Upload one to get started.'
        }
        columns={columns}
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
