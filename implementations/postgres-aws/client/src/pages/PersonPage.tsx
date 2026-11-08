// A person's details, rates, this year's totals and every invoice they sent;
// with ?day=, only those with an item on that date.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { apiErrorMessage, getPerson, listReviewQueue, removeProfessional } from '../api/client';
import { ConfirmButton } from '../components/ConfirmButton';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { PersonDialog } from '../components/PersonDialog';
import { IN_REVIEW, SentInvoicesTable } from '../components/SentInvoicesTable';
import { useCountyControl } from '../components/CountyListControl';
import { countyOfInvoice } from '../components/InvoiceCells';
import { Toast, useToast } from '../components/Toast';
import { shownCaseNumber } from '../caseNumbers';
import { downloadCsv } from '../downloadCsv';
import { formatMoney, sumMoney } from '../formatMoney';
import { formatDate } from '../formatDateTime';
import { Notice } from '../components/Notice';
import { personPath } from '../staffPaths';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'decided', label: 'Decided' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

export default function PersonPage() {
  const { professionalId } = useParams<{ professionalId: string }>();
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const { data: person, error } = useApiResource(() => getPerson(professionalId as string), [professionalId, version]);
  const [searchParams] = useSearchParams();
  const dayParam = searchParams.get('day') ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined;
  const { data: queue, error: queueError, reload: reloadQueue } = useApiResource(() => listReviewQueue('all', { professionalId, day }), [professionalId, day]);
  const [filter, setFilter] = useState<FilterId>('all');
  const [caseNumber, setCaseNumber] = useState('');
  // Invoices whose case number matches, closely or exactly; null for all.
  const [matching, setMatching] = useState<Set<string> | null>(null);
  const [editing, setEditing] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();
  const [toast, setToast] = useToast();

  useEffect(() => {
    if (!caseNumber.trim()) {
      setMatching(null);
      return;
    }
    let cancelled = false;
    listReviewQueue('all', { professionalId, q: caseNumber, day }).then(
      (result) => !cancelled && setMatching(new Set(result.invoices.map((invoice) => invoice.invoiceId))),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [professionalId, caseNumber, day]);

  const invoices = [...(queue?.invoices ?? [])].sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
  const isShown = (invoice: (typeof invoices)[number], id: FilterId) =>
    id === 'all' || (id === 'waiting' ? IN_REVIEW.includes(invoice.statusCode) : !IN_REVIEW.includes(invoice.statusCode));
  const county = useCountyControl(
    invoices.filter((invoice) => isShown(invoice, filter) && (!matching || matching.has(invoice.invoiceId))),
    countyOfInvoice,
  );

  if (error || queueError || !person || !queue) {
    return <LoadState error={error ?? queueError} what="this person" />;
  }
  const year = String(new Date().getFullYear());
  const thisYear = invoices.filter((invoice) => invoice.submittedAt?.startsWith(year));
  const waiting = invoices.filter((invoice) => IN_REVIEW.includes(invoice.statusCode));
  const sum = (rows: typeof invoices, value: (row: (typeof invoices)[number]) => string | null) => sumMoney(rows.map(value));
  const shown = county.shown;
  const name = person.displayName ?? 'This person';

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
        status={person.role && <span className="chip chip--neutral">{person.role}</span>}
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
              <button type="button" className="btn btn--outline" onClick={() => setEditing(true)}>
                Edit details
              </button>
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
            <button
              type="button"
              className="btn btn--outline"
              disabled={invoices.length === 0}
              onClick={() =>
                downloadCsv(
                  `${name.replace(/[^A-Za-z0-9]+/g, '_')}_invoices.csv`,
                  invoices.map((invoice) => ({
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
                )
              }
            >
              Export spreadsheet
            </button>
          </>
        }
      />
      {removeError && <Notice tone="danger">{removeError}</Notice>}
      <FactsStrip>
        <Fact label="Approved rate">
          <strong>{person.hourlyRate ? `${formatMoney(person.hourlyRate)} an hour` : 'None set'}</strong>
        </Fact>
        <Fact label="Mileage rate">{person.ratePerMile ? `${formatMoney(person.ratePerMile)} a mile` : 'None set'}</Fact>
        <Fact label="Invoices this year">{thisYear.length}</Fact>
        <Fact label="Requested this year">{formatMoney(sum(thisYear, (row) => row.submittedTotal))}</Fact>
        <Fact label="Approved this year">{formatMoney(sum(thisYear, (row) => row.approvedTotal))}</Fact>
        <Fact label="Waiting now" note={waiting.length > 0 ? `${formatMoney(sum(waiting, (row) => row.submittedTotal))} requested` : undefined}>
          {waiting.length} {waiting.length === 1 ? 'invoice' : 'invoices'}
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
        <div className="chip-filters" role="group" aria-label="Show">
          {FILTERS.map(({ id, label }) => (
            <button key={id} type="button" className="chip chip--filter" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="chip-count">{invoices.filter((invoice) => isShown(invoice, id)).length}</span>
            </button>
          ))}
        </div>
        {county.control}
        <label className="list-controls__search">
          <span className="usa-sr-only">Filter by case number</span>
          <input className="usa-input" type="search" placeholder="Filter by case number" value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} />
        </label>
      </div>
      <SentInvoicesTable invoices={shown} showFrom={false} emptyMessage={invoices.length === 0 ? 'No invoices sent yet.' : 'No invoices match.'} onChanged={reloadQueue} />
      <p className="compact-hint">
        Showing {shown.length} of {invoices.length}. Every invoice is filed under {name}. Case numbers are as they were typed, and the
        tool does not check them against a list of cases.
      </p>
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
