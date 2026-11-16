// Providers (design K30): everyone who bills, read-only. Administrators add and
// change them, and merge duplicates, in Settings.
import { Link as RouterLink, Navigate, useSearchParams } from 'react-router';
import type { BillingPerson } from '../api/client';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { peopleRequest } from '../caseRequests';
import { people } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { duplicatesPath, personPath, settingsPath } from '../staffPaths';
import { useSearchParamState, useSearchParamText } from '../hooks/useSearchParamState';
import { FilterTag } from '../components/ui/Tag';

export default function People() {
  const [role, setRole] = useSearchParamState<string>('role', '');
  const [query, setQuery] = useSearchParamText('q');
  const [params] = useSearchParams();
  const duplicatesTab = params.get('tab') === 'duplicates';
  const list = useBatchedResource(duplicatesTab ? null : people(peopleRequest(params)));
  const { summary } = list;

  // Its Review duplicates tab moved to Settings (design K67).
  if (duplicatesTab) return <Navigate to={duplicatesPath(params.get('merged') ? { merged: params.get('merged')! } : {})} replace />;
  const header = (
    <PageHeader
      list
      title="Providers"
      description="Everyone who can send invoices: attorneys, investigators and experts. Every invoice is filed under one of these people."
    />
  );
  if (list.error || !list.items || !summary) {
    return (
      <div>
        {header}
        <LoadState error={list.error} what="providers" />
      </div>
    );
  }
  const roles = summary.roles.map((row) => ({ value: row.role ?? 'none', label: row.role ?? 'No role', count: row.count })).sort((a, b) => a.label.localeCompare(b.label));
  const total = summary.roles.reduce((sum, row) => sum + row.count, 0);

  return (
    <div>
      {header}
      <div className="list-controls">
        <div className="tag-filters" role="group" aria-label="Show">
          <FilterTag aria-pressed={role === ''} onClick={() => setRole('')}>
            Everyone <span className="tag-count">{total}</span>
          </FilterTag>
          {roles.map((option) => (
            <FilterTag key={option.value} aria-pressed={role === option.value} onClick={() => setRole(option.value)}>
              {option.label}s <span className="tag-count">{option.count}</span>
            </FilterTag>
          ))}
        </div>
        <label className="list-controls__search">
          <span className="usa-sr-only">Search providers</span>
          <input className="usa-input" type="search" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <RecordTable<BillingPerson>
        className="queue-table"
        rows={list.items}
        rowKey={(person) => person.professionalId}
        emptyMessage={total === 0 && !query.trim() ? 'No providers yet. Administrators add them in Settings.' : 'No one matches.'}
        columns={[
          {
            header: 'Name',
            rowHeader: true,
            render: (person) => (
              <>
                {person.displayName ?? 'Unnamed'}
                {person.email && <span className="cell-note">{person.email}</span>}
              </>
            ),
          },
          { header: 'Role', render: (person) => person.role ?? '—' },
          { header: 'Paid through', render: (person) => person.paidThrough ?? '—' },
          {
            header: 'Approved rate',
            render: (person) => (person.hourlyRate ? `${formatMoney(person.hourlyRate)} an hour` : <span className="muted">None set</span>),
          },
          {
            header: 'Waiting for review',
            render: (person) =>
              person.waiting.count > 0 ? (
                <>
                  {person.waiting.count} {person.waiting.count === 1 ? 'invoice' : 'invoices'}
                  <span className="cell-note">{formatMoney(person.waiting.total)}</span>
                </>
              ) : (
                <span className="muted">None</span>
              ),
          },
          { header: 'Last invoice', render: (person) => (person.lastInvoiceAt ? formatDay(person.lastInvoiceAt) : '—') },
          {
            header: 'Open',
            hiddenHeader: true,
            align: 'right',
            render: (person) => (
              <RouterLink className="row-action" to={personPath(person.professionalId)}>
                Open<span className="usa-sr-only"> {person.displayName}</span>
              </RouterLink>
            ),
          },
        ]}
      />
      <MoreOnScroll list={list} what="providers" />
      <p className="compact-hint">
        A provider here can sign in and send invoices with the email shown once an administrator turns it on. Rates set here are the ones
        reviewers check invoices against. Administrators add and change providers in{' '}
        <RouterLink to={settingsPath('providers')}>Settings</RouterLink>.
      </p>
    </div>
  );
}
