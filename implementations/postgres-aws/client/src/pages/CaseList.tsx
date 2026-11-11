import { Link as RouterLink, useSearchParams } from 'react-router';
import type { CaseListRecord } from '../api/client';
import { useResource } from '../hooks/useResource';
import { cases as casesResource } from '../resources';
import { PageHeading } from '../components/PageHeading';
import { SearchInput } from '../components/SearchInput';
import { ResourceList } from '../components/ResourceList';
import { RecordTable } from '../components/RecordTable';
import { useCountyControl } from '../components/CountyListControl';
import { stageLabel } from '../overviewStages';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { useSearchParamState, useSearchParamText } from '../hooks/useSearchParamState';
import { FilterTag, Tag } from '../components/ui/Tag';

type Shown = 'all' | 'open' | 'closed';

function matchesQuery(caseRecord: CaseListRecord, query: string): boolean {
  const haystack = `${caseRecord.clientDisplayName ?? ''} ${caseRecord.caseNumber ?? ''} ${caseRecord.workers.join(' ')}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

// Every case, as design I48 lists them.
export default function CaseList() {
  const { data, error } = useResource(casesResource);
  const cases = data?.cases ?? null;
  const [query, setQuery] = useSearchParamText('q');
  const [shown, setShown] = useSearchParamState<Shown>('show', 'all', ['all', 'open', 'closed']);
  // ?stage=<id> narrows to one stage (the Case overview's "View all" links set it).
  const [searchParams] = useSearchParams();
  const stageParam = searchParams.get('stage');
  const listed = (cases ?? []).filter(
    (caseRecord) =>
      (!stageParam || caseRecord.stage === stageParam) &&
      (shown === 'all' || (shown === 'open') === !caseRecord.closedOn) &&
      matchesQuery(caseRecord, query),
  );
  const county = useCountyControl(listed, (caseRecord) => ({ countyId: caseRecord.countyId }), { hideLabel: true });
  const count = (which: Shown) => (cases ?? []).filter((caseRecord) => which === 'all' || (which === 'open') === !caseRecord.closedOn).length;

  return (
    <ResourceList
      heading={
        <PageHeading
          list
          eyebrow="Cases"
          title={stageParam ? `${stageLabel(stageParam)} cases` : 'All cases'}
          description={`Every case invoices can be sent for. Cases may be managed in your ${EXTERNAL_SYSTEM_NAME}; they show here so invoices make sense.`}
        />
      }
      error={error}
      data={cases}
      errorMessage="Failed to load cases."
      loadingMessage="Loading cases…"
      emptyMessage="No cases yet."
    >
      {() => (
        <>
          {stageParam && (
            <p className="stage-filter-note">
              Showing only <strong>{stageLabel(stageParam)}</strong> cases. <RouterLink to="/cases">Show all cases</RouterLink>
            </p>
          )}
          <div className="list-toolbar">
            <div className="tag-filters" role="group" aria-label="Which cases">
              {(['all', 'open', 'closed'] as const).map((which) => (
                <FilterTag
                  key={which}
                  aria-pressed={shown === which}
                  onClick={() => setShown(which)}
                >
                  {which === 'all' ? 'All' : which === 'open' ? 'Open' : 'Closed'} <span className="tag-count">{count(which)}</span>
                </FilterTag>
              ))}
            </div>
            <div className="list-toolbar__filters">
              {county.control}
              <SearchInput
                id="case-filter"
                name="caseFilter"
                aria-label="Search cases by client, case number or who works on it"
                placeholder="Search by client or case number"
                value={query}
                onChange={setQuery}
              />
            </div>
          </div>
          <RecordTable
            label="Cases"
            className="queue-table case-list-table"
            rows={county.shown}
            rowKey={(caseRecord) => caseRecord.caseId}
            emptyMessage="No cases match."
            columns={[
              {
                header: 'Client',
                rowHeader: true,
                render: (caseRecord) => (
                  <RouterLink to={`/cases/${caseRecord.caseId}`}>{caseRecord.clientDisplayName || 'Unnamed client'}</RouterLink>
                ),
              },
              { header: 'Case', render: (caseRecord) => caseRecord.caseNumber ?? '—' },
              { header: 'Stage', render: (caseRecord) => <Tag tone="neutral">{stageLabel(caseRecord.stage)}</Tag> },
              { header: 'County', render: (caseRecord) => county.nameOf(caseRecord.countyId) ?? '—' },
              {
                header: 'Who works on it',
                render: (caseRecord) => (caseRecord.workers.length > 0 ? caseRecord.workers.join(', ') : <span className="muted">No one yet</span>),
              },
              { header: 'Pre-authorized', render: (caseRecord) => (caseRecord.preauthorized ? formatMoney(caseRecord.preauthorized) : '—') },
              {
                header: 'Waiting',
                render: (caseRecord) =>
                  caseRecord.waiting.count > 0 ? (
                    <>
                      {caseRecord.waiting.count} {caseRecord.waiting.count === 1 ? 'invoice' : 'invoices'}
                      <span className="cell-note">{formatMoney(caseRecord.waiting.total)}</span>
                    </>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </>
      )}
    </ResourceList>
  );
}
