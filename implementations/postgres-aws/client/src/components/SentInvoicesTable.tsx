// Sent invoices, each with its case number as typed and how many others
// share it: a person's page (design G23) and search results (G24).
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import type { ReviewQueueItem } from '../api/client';
import { RecordTable, type RecordTableColumn } from './RecordTable';
import { StatusPill } from './StatusPill';
import { openInvoiceColumn } from './InvoiceCells';
import { matchesNote, searchPath, shownCaseNumber } from '../caseNumbers';
import { formatDate, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';

export const IN_REVIEW = ['submitted', 'under_review', 'awaiting_sign_off'];

export function SentInvoicesTable({
  invoices,
  showFrom,
  caseNumberNote,
  emptyMessage,
}: {
  invoices: ReviewQueueItem[];
  showFrom: boolean;
  // In place of the "Also on…" note, such as "Close match".
  caseNumberNote?: (invoice: ReviewQueueItem) => ReactNode;
  emptyMessage: string;
}) {
  const columns: Array<RecordTableColumn<ReviewQueueItem>> = [
    ...(showFrom
      ? [
          {
            header: 'From',
            rowHeader: true,
            render: (invoice: ReviewQueueItem) => (
              <>
                {submittedByLabel(invoice)}
                <span className="cell-note">{invoice.professionalKindDisplayName ?? 'Professional'}</span>
              </>
            ),
          },
        ]
      : []),
    {
      header: 'Case number, as typed',
      className: 'case-number-cell',
      render: (invoice) => {
        const number = shownCaseNumber(invoice);
        const note = caseNumberNote ? caseNumberNote(invoice) : matchesNote(invoice.caseNumberMatches);
        return (
          <>
            <strong>{number ?? '—'}</strong>
            {note &&
              (caseNumberNote || !number ? (
                <span className="cell-note">{note}</span>
              ) : (
                <RouterLink className="cell-note" to={searchPath(number)}>
                  {note}
                </RouterLink>
              ))}
          </>
        );
      },
    },
    { header: 'Billing period', render: (invoice) => formatPeriod(invoice.periodStart, invoice.periodEnd) },
    { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—') },
    { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
    {
      header: 'Approved',
      align: 'right',
      render: (invoice) => (invoice.approvedTotal !== null ? formatMoney(invoice.approvedTotal) : <span className="muted">None yet</span>),
    },
    { header: 'Status', render: (invoice) => <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /> },
    openInvoiceColumn((invoice) => (IN_REVIEW.includes(invoice.statusCode) ? 'Review' : 'View')),
  ];
  return <RecordTable className="queue-table" rows={invoices} rowKey={(invoice) => invoice.invoiceId} emptyMessage={emptyMessage} columns={columns} />;
}
