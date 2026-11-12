// A person's details, rates, this year's totals and every invoice they sent;
// with ?day=, only those with an item on that date.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { apiErrorMessage, listReviewQueue, removeProfessional } from '../api/client';
import { ConfirmButton } from '../components/ConfirmButton';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { LARGEST_BATCH, loadAllBatches } from '../api/batches';
import { personRequest, personShowOf, PERSON_FILTERS, type PersonFilterId } from '../queueRequests';
import { person as personResource, personInvoices } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { PersonDialog } from '../components/PersonDialog';
import { SentInvoicesTable } from '../components/SentInvoicesTable';
import { useCountyControl } from '../components/CountyListControl';
import { Toast, useToast } from '../components/Toast';
import { shownCaseNumber } from '../caseNumbers';
import { downloadCsv } from '../downloadCsv';
import { formatMoney } from '../formatMoney';
import { formatDate } from '../formatDateTime';
import { Notice } from '../components/ui/Notice';
import { personPath } from '../staffPaths';
import { ProviderOnFile } from '../components/preauthorizationRequest/ProviderOnFile';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { FilterTag, Tag } from '../components/ui/Tag';
import { Button } from '../components/ui/Button';

const FILTERS = PERSON_FILTERS;
type FilterId = PersonFilterId;

export default function PersonPage() {
  const { professionalId } = useParams<{ professionalId: string }>();
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const { data: person, error } = useResource(personResource(professionalId as string), { resetKey: version });
  const [searchParams] = useSearchParams();
  const dayParam = searchParams.get('day') ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined;
  const [filter, setFilter] = useSearchParamState<FilterId>('show', 'all', FILTERS.map((option) => option.id));
  const [caseNumber, setCaseNumber] = useState('');
  const [editing, setEditing] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [toast, setToast] = useToast();
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

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeProfessional(professionalId as string);
      navigate('/people');
    } catch (err) {
      setRemoveError(apiErrorMessage(err, 'They could not be removed.'));
      setRemoving(false);
    }
  }

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'People', to: '/people' }, { label: name }]}
        title={name}
        status={person.role && <Tag tone="neutral">{person.role}</Tag>}
        meta={
          <>
            {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
            {person.phone && <span>{person.phone}</span>}
            {person.paidThrough && <span>Paid to {person.paidThrough}</span>}
            <span>
              External sign-in: {person.externalSignInEnabled ? 'On' : 'Off'}
              {user?.isAdmin && (
                <>
                  {' '}
                  (<Link to="/settings#settings-external-users">change in Settings</Link>)
                </>
              )}
            </span>
          </>
        }
        actions={
          <>
            {user?.isAdmin && (
              <Button kind="secondary" onClick={() => setEditing(true)}>
                Edit details
              </Button>
            )}
            {user?.isAdmin && (
              <ConfirmButton
                label="Remove"
                prompt={`Remove ${name}? Only someone added by mistake can be removed. Unsent invoices from them will have no one chosen.`}
                confirmLabel="Yes, remove"
                disabled={removing}
                onConfirm={() => void remove()}
              />
            )}
            <Button kind="secondary" disabled={total === 0} onClick={() => void exportAll()}>
              Export spreadsheet
            </Button>
          </>
        }
      />
      {removeError && <Notice tone="danger">{removeError}</Notice>}
      {exportError && <Notice tone="danger">{exportError}</Notice>}
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
      <ProviderOnFile professionalId={professionalId as string} name={name} />
      {editing && (
        <PersonDialog
          person={person}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setToast({ message: 'Details saved.' });
            setVersion((v) => v + 1);
          }}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
