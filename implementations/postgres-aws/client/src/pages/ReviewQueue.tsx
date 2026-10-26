import { useMemo } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import { listReviewQueue, type ReviewQueueItem } from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { StatusPill } from '../components/StatusPill';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

const FILTERS = [
  { id: 'everyone', label: "Everyone's" },
  { id: 'mine', label: 'Assigned to you' },
  { id: 'unassigned', label: 'Not assigned yet' },
  { id: 'flagged', label: 'Has a flag' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

function matches(invoice: ReviewQueueItem, filter: FilterId, userAccountId: string): boolean {
  switch (filter) {
    case 'mine':
      return invoice.holder?.userAccountId === userAccountId;
    case 'unassigned':
      return !invoice.reviewer;
    case 'flagged':
      return invoice.flags.length > 0;
    default:
      return true;
  }
}

function matchesQuery(invoice: ReviewQueueItem, query: string): boolean {
  const haystack = [
    invoice.caseNumber,
    ...invoice.otherCaseNumbers,
    invoice.caseClientDisplayName,
    invoice.professionalDisplayName,
    invoice.submittedByDisplayName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function From({ invoice }: { invoice: ReviewQueueItem }) {
  const delegated = invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName;
  return (
    <>
      {invoice.professionalDisplayName ?? 'Unknown'}
      <span className="cell-note">
        {invoice.professionalKindDisplayName ?? 'Professional'}
        {delegated ? `, sent by ${invoice.submittedByDisplayName}` : ''}
      </span>
    </>
  );
}

// The first screen: invoices waiting for a decision, who has each and how
// long it has waited (working days), so nothing quietly stalls.
export default function ReviewQueue({ view }: { view: 'open' | 'finished' }) {
  const { user } = useAuth();
  const userAccountId = user?.userAccountId ?? '';
  const [params, setParams] = useSearchParams();
  const filter: FilterId = view === 'open' ? ((params.get('show') as FilterId | null) ?? 'mine') : 'everyone';
  const query = params.get('q') ?? '';
  const { data, error } = useApiResource(() => listReviewQueue(view), [view]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ id }) => [id, data?.invoices.filter((invoice) => matches(invoice, id, userAccountId)).length ?? 0]),
      ) as Record<FilterId, number>,
    [data, userAccountId],
  );

  if (error) {
    return <Alert type="error">Failed to load invoices.</Alert>;
  }
  if (!data) {
    return <p role="status">Loading invoices…</p>;
  }

  const shown = data.invoices.filter((invoice) => matches(invoice, filter, userAccountId) && (!query || matchesQuery(invoice, query)));
  const late = view === 'open' ? data.invoices.filter((invoice) => invoice.workingDaysWaiting > data.waitingAlertWorkingDays) : [];

  return (
    <div>
      <div className="page-title-row">
        <div>
          <h1>{view === 'open' ? 'Invoices to review' : 'Finished invoices'}</h1>
          <p className="page-description">
            {view === 'open'
              ? 'Every invoice waiting for a decision, longest wait first.'
              : 'Invoices signed off or rejected. Export them from the invoice.'}
          </p>
        </div>
      </div>

      {late.length > 0 && (
        <div className="notice notice--warning" role="status">
          <strong>
            {late.length} {late.length === 1 ? 'invoice has' : 'invoices have'} waited more than {data.waitingAlertWorkingDays} working days.
          </strong>
          <span>
            {late
              .map(
                (invoice) =>
                  `${invoice.caseClientDisplayName ?? 'Unknown client'}, ${formatMoney(invoice.submittedTotal)}, ${
                    invoice.holder ? `with ${invoice.holder.displayName}` : 'not assigned'
                  } for ${invoice.workingDaysWaiting} working days`,
              )
              .join('. ')}
            .
          </span>
        </div>
      )}

      {view === 'open' && (
        <div className="chip-filters" role="group" aria-label="Show">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`chip chip--filter${id === 'flagged' ? ' chip--warning' : ''}`}
              aria-pressed={filter === id}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('show', id);
                setParams(next);
              }}
            >
              {label} <span className="chip-count">{counts[id]}</span>
            </button>
          ))}
          {query && (
            <span className="chip chip--neutral">
              Matching “{query}”
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('q');
                  setParams(next);
                }}
              >
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="empty-note">
          {filter === 'mine' && view === 'open'
            ? 'Nothing is waiting on you. See everyone’s invoices to pick one up.'
            : 'No invoices here.'}
        </p>
      ) : (
        <div className="data-card">
          <table className="usa-table queue-table">
            <thead>
              <tr>
                <th scope="col">Case number</th>
                <th scope="col">Client</th>
                <th scope="col">From</th>
                <th scope="col">Submitted</th>
                <th scope="col" className="amount">Requested</th>
                <th scope="col">Decided</th>
                <th scope="col">{view === 'open' ? 'Who has it' : 'Status'}</th>
                {view === 'open' && <th scope="col">Working days</th>}
                <th scope="col"><span className="usa-sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((invoice) => (
                <tr key={invoice.invoiceId}>
                  <th scope="row" className="case-number-cell">
                    {invoice.caseNumber ?? '—'}
                    {invoice.otherCaseNumbers.length > 0 && <span className="cell-note">{invoice.otherCaseNumbers.join(', ')}</span>}
                  </th>
                  <td>
                    {invoice.caseClientDisplayName ?? '—'}
                    {invoice.flags.map((flag) => (
                      <span key={flag.kind} className="cell-flag">{flag.message}</span>
                    ))}
                  </td>
                  <td><From invoice={invoice} /></td>
                  <td>{invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—'}</td>
                  <td className="amount"><strong>{formatMoney(invoice.submittedTotal)}</strong></td>
                  <td>{invoice.decidedCount} of {invoice.lineCount}</td>
                  <td>
                    {view === 'open' ? (
                      invoice.holder ? (
                        <>
                          {invoice.holder.displayName}
                          {invoice.statusCode === 'awaiting_sign_off' && <span className="cell-note">To sign off</span>}
                        </>
                      ) : (
                        <span className="muted">Not assigned</span>
                      )
                    ) : (
                      <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} />
                    )}
                  </td>
                  {view === 'open' && (
                    <td className={invoice.workingDaysWaiting > data.waitingAlertWorkingDays ? 'late' : undefined}>
                      {invoice.workingDaysWaiting} {invoice.workingDaysWaiting === 1 ? 'day' : 'days'}
                    </td>
                  )}
                  <td>
                    <RouterLink className="row-action" to={`/billing/${invoice.invoiceId}`}>
                      {view === 'open' ? 'Review' : 'View'} <span aria-hidden="true">→</span>
                      <span className="usa-sr-only"> invoice for {invoice.caseClientDisplayName ?? 'this case'}</span>
                    </RouterLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
