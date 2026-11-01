// Every sent invoice matching a name or case number. Close matches are
// totalled apart from exact ones, so the wrong case isn't added up by accident.
import { useSearchParams } from 'react-router';
import { listReviewQueue, type ReviewQueueItem } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { SentInvoicesTable } from '../components/SentInvoicesTable';
import { shownCaseNumber } from '../caseNumbers';
import { downloadCsv } from '../downloadCsv';
import { formatPeriod } from '../formatDateTime';
import { formatMoney, sumMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';

export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const { data, error } = useApiResource(
    () => (query ? listReviewQueue('all', { q: query }) : Promise.resolve({ invoices: [] as ReviewQueueItem[] })),
    [query],
  );

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }
  const found = [...data.invoices].sort((a, b) =>
    a.match === b.match ? (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '') : a.match === 'exact' ? -1 : 1,
  );
  const exact = found.filter((invoice) => invoice.match === 'exact');
  const close = found.filter((invoice) => invoice.match === 'close');
  const total = (rows: ReviewQueueItem[]) => sumMoney(rows.map((row) => row.submittedTotal));
  const people = new Set(found.map((invoice) => invoice.professionalId)).size;
  const byNumber = /\d/.test(query);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Search' }, { label: query || 'Nothing yet' }]}
        title={byNumber ? `Invoices with a case number like ${query}` : `Invoices matching “${query}”`}
        description={
          query
            ? `${plural(found.length, 'invoice')} from ${people === 1 ? '1 person' : `${people} people`}. People type case numbers themselves, so close matches are shown too.`
            : 'Search by a name or a case number in the box at the top.'
        }
      />
      {close.length > 0 && (
        <Notice tone="warning" heading={`${plural(close.length, 'invoice')} ${close.length === 1 ? 'is a close match' : 'are close matches'}, not exact.`}>
          {close
            .map((invoice) => `${submittedByLabel(invoice)} typed ${shownCaseNumber(invoice)} on their invoice for ${formatPeriod(invoice.periodStart, invoice.periodEnd)}`)
            .join('. ')}
          . Check it is the same case before you add these invoices up.
        </Notice>
      )}
      <SentInvoicesTable
        invoices={found}
        showFrom
        caseNumberNote={(invoice) => (close.includes(invoice) ? <span className="text-warning">Close match</span> : null)}
        emptyMessage={query ? 'No sent invoices match.' : 'Nothing searched yet.'}
      />
      {found.length > 0 && (
        <div className="search-totals">
          <div>
            <strong>
              {close.length > 0 ? 'Exact matches: ' : ''}
              {plural(exact.length, 'invoice')}, {formatMoney(total(exact))} requested.
            </strong>
            {close.length > 0 && (
              <p className="compact-hint">
                {close.length === 1 ? 'Close match' : 'Close matches'}: {plural(close.length, 'invoice')}, {formatMoney(total(close))} requested.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() =>
              downloadCsv(
                `search_${query.replace(/[^A-Za-z0-9]+/g, '_')}.csv`,
                found.map((invoice) => ({
                  From: submittedByLabel(invoice),
                  'Case number': shownCaseNumber(invoice),
                  Match: invoice.match === 'exact' ? 'Exact' : 'Close',
                  'Billing period start': invoice.periodStart,
                  'Billing period end': invoice.periodEnd,
                  Submitted: invoice.submittedAt?.slice(0, 10),
                  Requested: invoice.submittedTotal,
                  Approved: invoice.approvedTotal,
                  Status: invoice.statusDisplayName,
                })),
              )
            }
          >
            Export these to a spreadsheet
          </button>
        </div>
      )}
    </div>
  );
}
