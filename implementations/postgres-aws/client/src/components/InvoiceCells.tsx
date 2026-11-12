import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import type { ReviewQueueItem } from '../api/client';
import { submittedByLabel } from '../reviewTotals';
import { matchesNote, shownCaseNumber } from '../caseNumbers';
import { searchPath } from '../staffPaths';
import type { RecordTableColumn } from './RecordTable';
import { StatusPill } from './StatusPill';

// Cells shared by the staff tables of invoices.

export const caseNumberColumn: RecordTableColumn<ReviewQueueItem> = {
  header: 'Case number',
  rowHeader: true,
  className: 'case-number-cell',
  render: (invoice) => (
    <>
      {invoice.caseNumber ?? '—'}
      {invoice.otherCaseNumbers.length > 0 && <span className="cell-note">{invoice.otherCaseNumbers.join(', ')}</span>}
      <CountyNote invoice={invoice} />
    </>
  ),
};

function CountyNote({ invoice }: { invoice: ReviewQueueItem }) {
  return invoice.countyDisplayName ? <span className="cell-note">{invoice.countyDisplayName}</span> : null;
}

export function FromCell({ invoice }: { invoice: ReviewQueueItem }) {
  return (
    <>
      {submittedByLabel(invoice)}
      <span className="cell-note">{invoice.professionalKindDisplayName ?? 'Professional'}</span>
    </>
  );
}

// As typed or corrected, with its county and a link to sent invoices sharing it (or `note`).
export function CaseNumberCell({ invoice, note }: { invoice: ReviewQueueItem; note?: ReactNode }) {
  const number = shownCaseNumber(invoice);
  if (!number) {
    return (
      <>
        <span className="muted">Not added</span>
        <CountyNote invoice={invoice} />
      </>
    );
  }
  const matches = matchesNote(invoice.caseNumberMatches);
  return (
    <>
      <strong>{number}</strong>
      <CountyNote invoice={invoice} />
      {note !== undefined ? (
        note && <span className="cell-note">{note}</span>
      ) : (
        matches && (
          <RouterLink className="cell-note" to={searchPath(number)}>
            {matches}
          </RouterLink>
        )
      )}
    </>
  );
}

export function FlagNotes({ invoice }: { invoice: ReviewQueueItem }) {
  return (
    <>
      {invoice.flags.map((flag) => (
        <span key={flag.kind} className="cell-flag">{flag.message}</span>
      ))}
    </>
  );
}

// Questions to the submitter while the round isn't finished: unanswered ones
// hold review, answered ones are back with the reviewer.
// The row's live state: still being entered, and questions waiting or answered.
export function QuestionChips({ invoice }: { invoice: ReviewQueueItem }) {
  const { openQuestionCount: open, answeredQuestionCount: answered, beingEntered } = invoice;
  if (open === 0 && answered === 0 && !beingEntered) {
    return null;
  }
  return (
    <span className="question-tags">
      {beingEntered && <StatusPill tone="info" label="Being entered" />}
      {open > 0 && <StatusPill tone="warning" label={open === 1 ? 'Question unanswered' : `${open} questions unanswered`} />}
      {answered > 0 && <StatusPill tone="info" label={answered === 1 ? 'Question answered' : `${answered} questions answered`} />}
    </span>
  );
}

// The row's link to the invoice, last in the row.
export function openInvoiceColumn(label: (invoice: ReviewQueueItem) => string): RecordTableColumn<ReviewQueueItem> {
  return {
    header: 'Open',
    hiddenHeader: true,
    align: 'right',
    render: (invoice) => (
      <RouterLink className="row-action" to={`/billing/${invoice.invoiceId}`}>
        {label(invoice)} <span aria-hidden="true">→</span>
        <span className="usa-sr-only"> invoice for {invoice.caseClientDisplayName ?? 'this case'}</span>
      </RouterLink>
    ),
  };
}
