// Everyone who can send invoices, in place of Cases and Providers.
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { listPeople, type BillingPerson } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { PersonDialog } from '../components/PersonDialog';
import { formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { personPath } from '../staffPaths';

export default function People() {
  const navigate = useNavigate();
  const { data, error } = useApiResource(() => listPeople().then((result) => result.people), []);
  const [role, setRole] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const roles = useMemo(() => [...new Set((data ?? []).map((person) => person.role ?? 'No role'))].sort(), [data]);

  if (error || !data) {
    return <LoadState error={error} what="people" />;
  }
  const words = query.trim().toLowerCase();
  const shown = data.filter(
    (person) =>
      (!role || (person.role ?? 'No role') === role) &&
      (!words || [person.displayName, person.email].filter(Boolean).join(' ').toLowerCase().includes(words)),
  );
  const count = (name: string | null) => data.filter((person) => !name || (person.role ?? 'No role') === name).length;

  return (
    <div>
      <PageHeader
        title="People"
        description="Everyone who can send invoices: attorneys, investigators and experts. Every invoice is filed under one of these people."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            Add a person
          </button>
        }
      />
      <div className="list-controls">
        <div className="chip-filters" role="group" aria-label="Show">
          {[null, ...roles].map((name) => (
            <button key={name ?? 'everyone'} type="button" className="chip chip--filter" aria-pressed={role === name} onClick={() => setRole(name)}>
              {name ? `${name}s` : 'Everyone'} <span className="chip-count">{count(name)}</span>
            </button>
          ))}
        </div>
        <label className="list-controls__search">
          <span className="usa-sr-only">Search people</span>
          <input className="usa-input" type="search" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <RecordTable<BillingPerson>
        className="queue-table"
        rows={shown}
        rowKey={(person) => person.professionalId}
        emptyMessage={data.length === 0 ? 'No one yet. Add a person to let them send invoices.' : 'No one matches.'}
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
      <p className="compact-hint">A person here can sign in and send invoices with the email shown. Rates set here are the ones reviewers check invoices against.</p>
      {adding && (
        <PersonDialog onClose={() => setAdding(false)} onSaved={(saved) => navigate(personPath(saved.professionalId))} />
      )}
    </div>
  );
}
