// Sent invoices with their case numbers as typed, for a person's page and search.
import type { ReactNode } from 'react';
import type { ReviewQueueItem } from '../api/client';
import { RecordTable, type RecordTableColumn } from './RecordTable';
import { InvoiceStatus } from './Completion';
import { CaseNumberCell, FromCell, openInvoiceColumn, QuestionChips } from './InvoiceCells';
import { formatPeriod, formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

export function SentInvoicesTable({
  invoices,
  showFrom,
  caseNumberNote,
  rowClassName,
  emptyMessage,
  onChanged,
}: {
  invoices: ReviewQueueItem[];
  showFrom: boolean;
  // In place of how many others share the number.
  caseNumberNote?: (invoice: ReviewQueueItem) => ReactNode;
  rowClassName?: (invoice: ReviewQueueItem) => string | undefined;
  emptyMessage: string;
  onChanged: () => unknown;
}) {
  const columns: Array<RecordTableColumn<ReviewQueueItem>> = [
    ...(showFrom ? [{ header: 'From', rowHeader: true, render: (invoice: ReviewQueueItem) => <FromCell invoice={invoice} /> }] : []),
    {
      header: 'Case number',
      className: 'case-number-cell',
      render: (invoice) => <CaseNumberCell invoice={invoice} note={caseNumberNote?.(invoice)} />,
    },
    { header: 'Billing period', render: (invoice) => formatPeriod(invoice.periodStart, invoice.periodEnd) },
    { header: 'Submitted', className: 'nowrap', render: (invoice) => (invoice.submittedAt ? formatDay(invoice.submittedAt) : '—') },
    { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
    {
      header: 'Approved',
      align: 'right',
      className: (invoice) => (invoice.approvedTotal !== null ? 'approved-amount' : undefined),
      render: (invoice) => (invoice.approvedTotal !== null ? formatMoney(invoice.approvedTotal) : <span className="muted">None yet</span>),
    },
    {
      header: 'Status',
      render: (invoice) => (
        <>
          <InvoiceStatus invoice={invoice} onCompleted={onChanged} />
          <QuestionChips invoice={invoice} />
        </>
      ),
    },
    openInvoiceColumn(),
  ];
  return <RecordTable className="queue-table" rows={invoices} rowKey={(invoice) => invoice.invoiceId} rowClassName={rowClassName} emptyMessage={emptyMessage} columns={columns} />;
}
