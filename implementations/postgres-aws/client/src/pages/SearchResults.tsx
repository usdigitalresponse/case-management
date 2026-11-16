// Every sent invoice matching a name or case number. Close matches are
// totalled apart from exact ones, so the wrong case isn't added up by accident.
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiErrorMessage, listReviewQueue } from '../api/client';
import { LARGEST_BATCH, loadAllBatches } from '../api/batches';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { reviewQueue } from '../resources';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { searchRequest } from '../queueRequests';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { SentInvoicesTable } from '../components/SentInvoicesTable';
import { useCountyControl } from '../components/CountyListControl';
import { shownCaseNumber } from '../caseNumbers';
import { downloadCsv } from '../downloadCsv';
import { formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';
import { Button } from '../components/ui/Button';

export default function SearchResults() {
  const [params] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const request = searchRequest(params);
  const list = useBatchedResource(query ? reviewQueue(request) : null);
  const { reload, summary } = list;
  const county = useCountyControl(summary?.counties ?? null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (query && (list.error || !list.items || !summary?.search)) {
    return <LoadState error={list.error} what="invoices" />;
  }
  const found = list.items ?? [];
  const search = summary?.search;
  const exact = search?.exact ?? { count: 0, requested: '0' };
  const close = search?.close ?? { count: 0, requested: '0', invoices: [] };
  const total = exact.count + close.count;
  const people = search?.people ?? 0;
  const byNumber = /\d/.test(query);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function exportAll() {
    setExportError(null);
    try {
      const rows = await loadAllBatches((after) => listReviewQueue(request, after, LARGEST_BATCH));
      downloadCsv(
        `search_${query.replace(/[^A-Za-z0-9]+/g, '_')}.csv`,
        rows.map((invoice) => ({
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
      );
    } catch (err) {
      setExportError(apiErrorMessage(err, 'The spreadsheet could not be made. Try again.'));
    }
  }

  return (
    <div>
      <PageHeader
        list
        crumbs={[{ label: 'Search' }, { label: query || 'Nothing yet' }]}
        title={byNumber ? `Invoices with a case number like ${query}` : `Invoices matching “${query}”`}
        description={
          query
            ? `${plural(total, 'invoice')} from ${people === 1 ? '1 person' : `${people} people`}. People type case numbers themselves, so close matches are shown too.`
            : 'Search by a name or a case number in the box at the top.'
        }
      />
      {close.count > 0 && (
        <Notice tone="warning" heading={`${plural(close.count, 'invoice')} ${close.count === 1 ? 'is a close match' : 'are close matches'}, not exact.`}>
          {close.invoices
            .map((invoice) => `${submittedByLabel(invoice)} typed ${invoice.caseNumber} on their invoice for ${formatPeriod(invoice.periodStart, invoice.periodEnd)}`)
            .join('. ')}
          . Check it is the same case before you add these invoices up.
        </Notice>
      )}
      {(total > 0 || county.narrowed) && <div className="list-controls">{county.control}</div>}
      <SentInvoicesTable
        invoices={found}
        showFrom
        caseNumberNote={(invoice) => (invoice.match === 'close' ? <span className="text-warning">Close match</span> : null)}
        rowClassName={(invoice) => (invoice.match === 'close' ? 'is-flagged' : undefined)}
        emptyMessage={county.narrowed ? 'No matching invoices for that county.' : query ? 'No sent invoices match.' : 'Nothing searched yet.'}
        onChanged={reload}
      />
      <MoreOnScroll list={list} what="invoices" />
      {total > 0 && (
        <div className="search-totals">
          <div>
            <strong>
              {close.count > 0 ? 'Exact matches: ' : ''}
              {plural(exact.count, 'invoice')}, {formatMoney(exact.requested)} requested.
            </strong>
            {close.count > 0 && (
              <p className="compact-hint">
                {close.count === 1 ? 'Close match' : 'Close matches'}: {plural(close.count, 'invoice')}, {formatMoney(close.requested)} requested.
              </p>
            )}
          </div>
          <Button kind="secondary" onClick={() => void exportAll()}>
            Export these to a spreadsheet
          </Button>
          {exportError && <Notice tone="danger">{exportError}</Notice>}
        </div>
      )}
    </div>
  );
}
