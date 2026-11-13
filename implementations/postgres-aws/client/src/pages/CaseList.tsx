import { Link as RouterLink, Navigate, useSearchParams } from 'react-router';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { caseListRequest, CASE_SHOWS, type CaseShow } from '../caseRequests';
import { cases as casesResource } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { SearchInput } from '../components/SearchInput';
import { ResourceList } from '../components/ResourceList';
import { RecordTable } from '../components/RecordTable';
import { useCountyControl } from '../components/CountyListControl';
import { stageLabel } from '../overviewStages';
import { duplicatesPath } from '../staffPaths';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { useSearchParamState, useSearchParamText } from '../hooks/useSearchParamState';
import { FilterTag, Tag, type Tone } from '../components/ui/Tag';

// As design I's All cases: billing in blue, waiting on a reviewer in yellow, closed in dark.
function stageTone(stage: string | null): Tone {
  return stage === 'billing' ? 'info' : stage === 'needs-assignment' ? 'warning' : stage === null ? 'strong' : 'neutral';
}

// Every case, as design I48 lists them; possible duplicates are merged in Settings (design K67).
export default function CaseList() {
  const [searchParams] = useSearchParams();
  const request = caseListRequest(searchParams);
  const duplicatesTab = searchParams.get('tab') === 'duplicates';
  const list = useBatchedResource(duplicatesTab ? null : casesResource(request));
  const { summary } = list;
  const [query, setQuery] = useSearchParamText('q');
  const [shown, setShown] = useSearchParamState<CaseShow>('show', 'all', CASE_SHOWS);
  const stageParam = searchParams.get('stage');
  const county = useCountyControl(summary?.counties ?? null, { hideLabel: true });

  if (duplicatesTab) return <Navigate to={duplicatesPath()} replace />;
  const heading = (
    <PageHeader
      list
      title={stageParam ? `${stageLabel(stageParam)} cases` : 'All cases'}
      description={`Every case number that has come in on an invoice. Cases are managed in your ${EXTERNAL_SYSTEM_NAME}, and “Open ↗” takes you to the case there.`}
    />
  );
  return (
    <ResourceList
      heading={heading}
      error={list.error}
      data={summary ? list.items : null}
      empty={summary?.counts.all === 0}
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
                  {which === 'all' ? 'All' : which === 'open' ? 'Open' : 'Closed'} {summary && <span className="tag-count">{summary.counts[which]}</span>}
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
            rows={list.items ?? []}
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
              { header: 'Stage', render: (caseRecord) => <Tag tone={stageTone(caseRecord.stage)}>{stageLabel(caseRecord.stage)}</Tag> },
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
              {
                header: 'Open',
                hiddenHeader: true,
                align: 'right',
                // Drawn but not connected: the tool isn't linked to the external system yet.
                render: (caseRecord) => (
                  <button type="button" className="link-button" disabled title="Not connected yet">
                    Open <span aria-hidden="true">↗</span>
                    <span className="usa-sr-only">
                      {' '}
                      case {caseRecord.caseNumber ?? caseRecord.clientDisplayName ?? ''} in your {EXTERNAL_SYSTEM_NAME}
                    </span>
                  </button>
                ),
              },
            ]}
          />
          <MoreOnScroll list={list} what="cases" />
        </>
      )}
    </ResourceList>
  );
}
