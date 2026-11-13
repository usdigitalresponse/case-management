// A provider's page (design K32), read-only: details, rates, this year's totals,
// their documents and every invoice they sent; with ?day=, only those with an
// item on that date. Administrators change them in Settings › Providers.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiErrorMessage, listReviewQueue } from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { LARGEST_BATCH, loadAllBatches } from '../api/batches';
import { personRequest, personShowOf, PERSON_FILTERS, type PersonFilterId } from '../queueRequests';
import { person as personResource, personInvoices, providerDuplicateOthers } from '../resources';
import { DuplicateNotice } from '../components/DuplicateNotice';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { SentInvoicesTable } from '../components/SentInvoicesTable';
import { useCountyControl } from '../components/CountyListControl';
import { shownCaseNumber } from '../caseNumbers';
import { downloadCsv } from '../downloadCsv';
import { formatMoney } from '../formatMoney';
import { formatDate } from '../formatDateTime';
import { Notice } from '../components/ui/Notice';
import { personPath } from '../staffPaths';
import { ProviderDocuments } from '../components/preauthorizationRequest/ProviderOnFile';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { FilterTag, Tag } from '../components/ui/Tag';
import { Button, buttonClass } from '../components/ui/Button';

const FILTERS = PERSON_FILTERS;
type FilterId = PersonFilterId;

export default function PersonPage() {
  const { professionalId } = useParams<{ professionalId: string }>();
  const { user } = useAuth();
  const { data: person, error } = useResource(personResource(professionalId as string));
  const [searchParams] = useSearchParams();
  const dayParam = searchParams.get('day') ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined;
  const [filter, setFilter] = useSearchParamState<FilterId>('show', 'all', FILTERS.map((option) => option.id));
  const [caseNumber, setCaseNumber] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const request = personRequest(professionalId as string, searchParams, caseNumber);
  const list = useBatchedResource(personInvoices(request));
  const { summary, reload: reloadQueue } = list;
  const county = useCountyControl(summary?.counties ?? null);

  if (error || list.error || !person || !list.items || !summary?.person) {
    return <LoadState error={error ?? list.error} what="this person" />;
  }
  const { thisYear, waiting, total } = summary.person;
  const shownCount = county.narrowed
    ? (summary.counties?.find((row) => (row.countyId ?? 'none') === request.county)?.count ?? 0)
    : (summary.counts[request.show ?? 'all'] ?? 0);
  const name = person.displayName ?? 'This person';

  async function exportAll() {
    setExportError(null);
    try {
      const rows = await loadAllBatches((after) => listReviewQueue({ view: 'all', professionalId, day, sort: 'newest' }, after, LARGEST_BATCH));
      downloadCsv(
        `${name.replace(/[^A-Za-z0-9]+/g, '_')}_invoices.csv`,
        rows.map((invoice) => ({
          'Case number': shownCaseNumber(invoice),
          'Case number as typed': invoice.caseNumberAsTyped,
          County: invoice.countyDisplayName,
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
        crumbs={[{ label: 'Providers', to: '/people' }, { label: name }]}
        title={name}
        status={person.role && <Tag tone="neutral">{person.role}</Tag>}
        meta={
          <>
            {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
            {person.phone && <span>{person.phone}</span>}
            {person.paidThrough && <span>Paid to {person.paidThrough}</span>}
          </>
        }
        actions={
          <>
            {user?.isAdmin && (
              <Link className={buttonClass('secondary')} to={`/settings?${new URLSearchParams({ providerQ: name })}#settings-providers`}>
                Change in Settings
              </Link>
            )}
            <Button kind="secondary" disabled={total === 0} onClick={() => void exportAll()}>
              Export spreadsheet
            </Button>
          </>
        }
      />
      {exportError && <Notice tone="danger">{exportError}</Notice>}
      <DuplicateNotice what="provider" others={providerDuplicateOthers(professionalId as string)} />
      <FactsStrip>
        <Fact label="Approved rate">
          <strong>{person.hourlyRate ? `${formatMoney(person.hourlyRate)} an hour` : 'None set'}</strong>
        </Fact>
        <Fact label="Mileage rate">{person.ratePerMile ? `${formatMoney(person.ratePerMile)} a mile` : 'None set'}</Fact>
        <Fact label="Travel time rate">
          {person.travelHourlyRate ? `${formatMoney(person.travelHourlyRate)} an hour` : 'The travel time setting'}
        </Fact>
        <Fact label="Invoices this year">{thisYear.count}</Fact>
        <Fact label="Requested this year">{formatMoney(thisYear.requested)}</Fact>
        <Fact label="Approved this year">{formatMoney(thisYear.approved)}</Fact>
        <Fact label="Waiting now" note={waiting.count > 0 ? `${formatMoney(waiting.requested)} requested` : undefined}>
          {waiting.count} {waiting.count === 1 ? 'invoice' : 'invoices'}
        </Fact>
        {person.reviewer && <Fact label="New invoices go to">{person.reviewer.displayName}</Fact>}
      </FactsStrip>
      <ProviderDocuments professionalId={professionalId as string} />
      {day && (
        <Notice tone="info">
          Showing only invoices with an item on {formatDate(day)}, such as travel on several cases that day.{' '}
          <Link to={personPath(professionalId as string)}>Show all their invoices</Link>
        </Notice>
      )}
      <div className="list-controls">
        <div className="tag-filters" role="group" aria-label="Show">
          {FILTERS.map(({ id, label }) => (
            <FilterTag key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="tag-count">{summary.counts[personShowOf(id)]}</span>
            </FilterTag>
          ))}
        </div>
        {county.control}
        <label className="list-controls__search">
          <span className="usa-sr-only">Filter by case number</span>
          <input className="usa-input" type="search" placeholder="Filter by case number" value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} />
        </label>
      </div>
      <SentInvoicesTable invoices={list.items} showFrom={false} emptyMessage={total === 0 ? 'No invoices sent yet.' : 'No invoices match.'} onChanged={reloadQueue} />
      <MoreOnScroll list={list} what="invoices" />
      <p className="compact-hint">
        Showing {shownCount} of {total}. Every invoice is filed under {name}. Case numbers are as they were typed, and the
        tool does not check them against a list of cases.
      </p>
    </div>
  );
}
