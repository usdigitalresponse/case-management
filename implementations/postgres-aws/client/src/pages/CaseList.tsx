import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Table } from '@trussworks/react-uswds';
import { listCases, type CaseRecord } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { SearchInput } from '../components/SearchInput';
import { ResourceList } from '../components/ResourceList';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { stageLabel } from '../overviewStages';

function matchesQuery(caseRecord: CaseRecord, query: string): boolean {
  const haystack = `${caseRecord.clientDisplayName ?? ''} ${caseRecord.externalReference ?? ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function CaseList() {
  const { data: cases, error } = useApiResource(() => listCases().then((result) => result.cases), []);
  const [query, setQuery] = useState('');
  // ?stage=<id> narrows to one board stage (sidebar/Overview "View all"
  // links set it). An unrecognized value just matches nothing, same as a
  // typo'd filter text.
  const [searchParams] = useSearchParams();
  const stageParam = searchParams.get('stage');

  return (
    <ResourceList
      heading={<PageHeading eyebrow="Cases" title={stageParam ? `${stageLabel(stageParam)} cases` : 'All cases'} />}
      error={error}
      data={cases}
      errorMessage="Failed to load cases."
      loadingMessage="Loading cases…"
      emptyMessage="No cases yet."
    >
      {(cases) => {
        const stageCases = stageParam ? cases.filter((caseRecord) => caseRecord.stage === stageParam) : cases;
        const filtered = stageCases.filter((caseRecord) => matchesQuery(caseRecord, query));
        return (
          <>
            {stageParam && (
              <p className="stage-filter-note">
                Showing only <strong>{stageLabel(stageParam)}</strong> cases.{' '}
                <RouterLink to="/cases">Show all cases</RouterLink>
              </p>
            )}
            <div className="list-toolbar">
              <SearchInput
                id="case-filter"
                name="caseFilter"
                aria-label="Filter cases by client or external reference"
                placeholder="Filter by client or external reference"
                value={query}
                onChange={setQuery}
              />
              <span className="list-count">
                {filtered.length} of {stageCases.length} {stageCases.length === 1 ? 'case' : 'cases'}
              </span>
            </div>

            <div className="data-card">
              <Table bordered fullWidth fixed className="case-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Status</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Opened</th>
                    <th scope="col">External reference</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((caseRecord) => (
                    <tr key={caseRecord.caseId}>
                      <th scope="row">
                        <RouterLink to={`/cases/${caseRecord.caseId}`}>
                          {caseDisplayLabel([caseRecord.clientDisplayName], { label: 'Case opened', date: caseRecord.openedOn })}
                        </RouterLink>
                      </th>
                      <td><span className="status-pill">{caseRecord.statusDisplayName}</span></td>
                      <td><span className="status-pill">{stageLabel(caseRecord.stage)}</span></td>
                      <td>{caseRecord.openedOn ?? '—'}</td>
                      <td>{caseRecord.externalReference ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <ul className="row-cards">
              {filtered.map((caseRecord) => (
                <li key={caseRecord.caseId}>
                  <RouterLink className="row-card" to={`/cases/${caseRecord.caseId}`}>
                    <span className="row-card-title">
                      {caseDisplayLabel([caseRecord.clientDisplayName], { label: 'Case opened', date: caseRecord.openedOn })}
                    </span>
                    <span className="row-card-meta">
                      <span className="status-pill">{caseRecord.statusDisplayName}</span>
                      <span className="status-pill">{stageLabel(caseRecord.stage)}</span>
                      <span>Opened {caseRecord.openedOn ?? '—'}</span>
                      {caseRecord.externalReference && <span>{caseRecord.externalReference}</span>}
                    </span>
                  </RouterLink>
                </li>
              ))}
            </ul>
          </>
        );
      }}
    </ResourceList>
  );
}
