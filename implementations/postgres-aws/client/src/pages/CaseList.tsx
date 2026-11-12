import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { caseListRequest, CASE_SHOWS, type CaseShow } from '../caseRequests';
import { cases as casesResource, possibleDuplicateCaseCount } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { DuplicateCases } from '../components/DuplicateCases';
import { DuplicatesTabs, useDuplicateCount, useListTab } from '../components/DuplicatesTabs';
import { Button } from '../components/ui/Button';
import { SearchInput } from '../components/SearchInput';
import { ResourceList } from '../components/ResourceList';
import { RecordTable } from '../components/RecordTable';
import { useCountyControl } from '../components/CountyListControl';
import { stageLabel } from '../overviewStages';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { useSearchParamState, useSearchParamText } from '../hooks/useSearchParamState';
import { FilterTag, Tag, type Tone } from '../components/ui/Tag';

// As design I's All cases: billing in blue, waiting on a reviewer in yellow, closed in dark.
function stageTone(stage: string | null): Tone {
  return stage === 'billing' ? 'info' : stage === 'needs-assignment' ? 'warning' : stage === null ? 'strong' : 'neutral';
}

// Every case, as design I48 lists them, and a tab of possible duplicate cases while there are any.
export default function CaseList() {
  const [searchParams] = useSearchParams();
  const request = caseListRequest(searchParams);
  const [tab, setTab] = useListTab();
  const list = useBatchedResource(tab === 'list' ? casesResource(request) : null);
  const { summary } = list;
  const [listed, setListed] = useState<number | null>(null);
  const toReview = useDuplicateCount(tab, possibleDuplicateCaseCount, listed);
  const [flagging, setFlagging] = useState(false);
  const [query, setQuery] = useSearchParamText('q');
  const [shown, setShown] = useSearchParamState<CaseShow>('show', 'all', CASE_SHOWS);
  const stageParam = searchParams.get('stage');
  const county = useCountyControl(summary?.counties ?? null, { hideLabel: true });

  const heading = (
    <>
      <PageHeader
        list
        title={stageParam ? `${stageLabel(stageParam)} cases` : 'All cases'}
        description={`Every case invoices can be sent for. Cases may be managed in your ${EXTERNAL_SYSTEM_NAME}; they show here so invoices make sense.`}
        actions={
          <Button
            kind="secondary"
            onClick={() => {
              setTab('duplicates');
              setFlagging(true);
            }}
          >
            Flag possible duplicates
          </Button>
        }
      />
      <DuplicatesTabs listLabel="Cases" toReview={toReview} show={(toReview ?? 0) > 0} tab={tab} onSelect={setTab} />
    </>
  );

  if (tab === 'duplicates') {
    return (
      <div>
        {heading}
        <DuplicateCases flagging={flagging} onFlaggingDone={() => setFlagging(false)} onCount={setListed} />
      </div>
    );
  }
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
            ]}
          />
          <MoreOnScroll list={list} what="cases" />
        </>
      )}
    </ResourceList>
  );
}
