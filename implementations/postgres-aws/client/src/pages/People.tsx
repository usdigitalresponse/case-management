// Everyone who can send invoices, in place of Cases and Providers, and a tab
// of possible duplicate people while there are any.
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import type { BillingPerson } from '../api/client';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { peopleRequest } from '../caseRequests';
import { people, possibleDuplicateCount } from '../resources';
import { DuplicatePeople } from '../components/DuplicatePeople';
import { DuplicatesTabs, useDuplicateCount, useListTab } from '../components/DuplicatesTabs';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { PersonDialog } from '../components/PersonDialog';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { personPath } from '../staffPaths';
import { useSearchParamState, useSearchParamText } from '../hooks/useSearchParamState';
import { Button } from '../components/ui/Button';
import { FilterTag } from '../components/ui/Tag';

export default function People() {
  const navigate = useNavigate();
  const [tab, setTab] = useListTab();
  const [role, setRole] = useSearchParamState<string>('role', '');
  const [query, setQuery] = useSearchParamText('q');
  const [params] = useSearchParams();
  const list = useBatchedResource(tab === 'list' ? people(peopleRequest(params)) : null);
  const [listed, setListed] = useState<number | null>(null);
  const toReview = useDuplicateCount(tab, possibleDuplicateCount, listed);
  const { summary } = list;
  const [adding, setAdding] = useState(false);
  const [flagging, setFlagging] = useState(false);

  const header = (
    <>
      <PageHeader
        list
        title="People"
        description="Everyone who can send invoices: attorneys, investigators and experts. Every invoice is filed under one of these people."
        actions={
          <>
            <Button
              kind="secondary"
              onClick={() => {
                setTab('duplicates');
                setFlagging(true);
              }}
            >
              Flag possible duplicates
            </Button>
            <Button kind="primary" onClick={() => setAdding(true)}>
              Add a person
            </Button>
          </>
        }
      />
      <DuplicatesTabs listLabel="People" toReview={toReview} show={(toReview ?? 0) > 0} tab={tab} onSelect={setTab} />
    </>
  );

  if (tab === 'duplicates') {
    return (
      <div>
        {header}
        <DuplicatePeople flagging={flagging} onFlaggingDone={() => setFlagging(false)} onCount={setListed} />
      </div>
    );
  }
  if (list.error || !list.items || !summary) {
    return (
      <div>
        {header}
        <LoadState error={list.error} what="people" />
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
          <span className="usa-sr-only">Search people</span>
          <input className="usa-input" type="search" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <RecordTable<BillingPerson>
        className="queue-table"
        rows={list.items}
        rowKey={(person) => person.professionalId}
        emptyMessage={total === 0 && !query.trim() ? 'No one yet. Add a person to let them send invoices.' : 'No one matches.'}
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
      <MoreOnScroll list={list} what="people" />
      <p className="compact-hint">A person here signs in to send invoices only once an administrator turns it on in{' '}
        <RouterLink to="/settings#settings-external-users">Settings, External users</RouterLink>. Rates set here are the ones reviewers check invoices against.</p>
      {adding && (
        <PersonDialog onClose={() => setAdding(false)} onSaved={(saved) => navigate(personPath(saved.professionalId))} />
      )}
    </div>
  );
}
