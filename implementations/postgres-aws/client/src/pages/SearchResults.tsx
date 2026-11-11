// Every sent invoice matching a name or case number. Close matches are
// totalled apart from exact ones, so the wrong case isn't added up by accident.
import { useSearchParams } from 'react-router';
import { type ReviewQueueItem } from '../api/client';
import { useResource } from '../hooks/useResource';
import { invoiceSearch } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { SentInvoicesTable } from '../components/SentInvoicesTable';
import { useCountyControl } from '../components/CountyListControl';
import { countyOfInvoice } from '../components/InvoiceCells';
import { shownCaseNumber } from '../caseNumbers';
import { downloadCsv } from '../downloadCsv';
import { formatPeriod } from '../formatDateTime';
import { formatMoney, sumMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';
import { Button } from '../components/ui/Button';

export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const searched = useResource(query ? invoiceSearch(query) : null);
  const { error, reload } = searched;
  const data = query ? searched.data : { invoices: [] as ReviewQueueItem[] };

  // Totals and the export follow the county chosen.
  const county = useCountyControl(
    [...(data?.invoices ?? [])].sort((a, b) =>
      a.match === b.match ? (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '') : a.match === 'exact' ? -1 : 1,
    ),
    countyOfInvoice,
  );

  if (error || !data) {
    return <LoadState error={error} what="invoices" />;
  }
  const found = county.shown;
  const exact = found.filter((invoice) => invoice.match === 'exact');
  const close = found.filter((invoice) => invoice.match === 'close');
  const total = (rows: ReviewQueueItem[]) => sumMoney(rows.map((row) => row.submittedTotal));
  const people = new Set(found.map((invoice) => invoice.professionalId)).size;
  const byNumber = /\d/.test(query);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader list
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
      {data.invoices.length > 0 && <div className="list-controls">{county.control}</div>}
      <SentInvoicesTable
        invoices={found}
        showFrom
        caseNumberNote={(invoice) => (close.includes(invoice) ? <span className="text-warning">Close match</span> : null)}
        emptyMessage={county.narrowed ? 'No matching invoices for that county.' : query ? 'No sent invoices match.' : 'Nothing searched yet.'}
        onChanged={reload}
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
          <Button
            type="button"
            kind="secondary"
            onClick={() =>
              downloadCsv(
                `search_${query.replace(/[^A-Za-z0-9]+/g, '_')}.csv`,
                found.map((invoice) => ({
                  From: submittedByLabel(invoice),
                  'Case number': shownCaseNumber(invoice),
                  County: invoice.countyDisplayName,
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
          </Button>
        </div>
      )}
    </div>
  );
}
