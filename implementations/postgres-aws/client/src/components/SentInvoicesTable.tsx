// Sent invoices with their case numbers as typed, for a person's page and search.
import type { ReactNode } from 'react';
import type { ReviewQueueItem } from '../api/client';
import { RecordTable, type RecordTableColumn } from './RecordTable';
import { InvoiceStatus } from './Completion';
import { CaseNumberCell, FromCell, openInvoiceColumn, QuestionChips } from './InvoiceCells';
import { formatDate, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

export const IN_REVIEW = ['submitted', 'under_review', 'awaiting_answer', 'awaiting_sign_off'];

export function SentInvoicesTable({
  invoices,
  showFrom,
  caseNumberNote,
  emptyMessage,
  onChanged,
}: {
  invoices: ReviewQueueItem[];
  showFrom: boolean;
  // In place of how many others share the number.
  caseNumberNote?: (invoice: ReviewQueueItem) => ReactNode;
  emptyMessage: string;
  onChanged: () => unknown;
}) {
  const columns: Array<RecordTableColumn<ReviewQueueItem>> = [
    ...(showFrom ? [{ header: 'From', rowHeader: true, render: (invoice: ReviewQueueItem) => <FromCell invoice={invoice} /> }] : []),
    {
      header: 'Case number, as typed',
      className: 'case-number-cell',
      render: (invoice) => <CaseNumberCell invoice={invoice} note={caseNumberNote?.(invoice)} />,
    },
    { header: 'Billing period', render: (invoice) => formatPeriod(invoice.periodStart, invoice.periodEnd) },
    { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—') },
    { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
    {
      header: 'Approved',
      align: 'right',
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
    openInvoiceColumn((invoice) => (IN_REVIEW.includes(invoice.statusCode) ? 'Review' : 'View')),
  ];
  return <RecordTable className="queue-table" rows={invoices} rowKey={(invoice) => invoice.invoiceId} emptyMessage={emptyMessage} columns={columns} />;
}
