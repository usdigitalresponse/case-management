import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Table, TextInput } from '@trussworks/react-uswds';
import { listCases, type CaseRecord } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { ResourceList } from '../components/ResourceList';
import { caseDisplayLabel } from '../caseDisplayLabel';

function matchesQuery(caseRecord: CaseRecord, query: string): boolean {
  const haystack = `${caseRecord.clientDisplayName ?? ''} ${caseRecord.externalReference ?? ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function CaseList() {
  const { data: cases, error } = useApiResource(() => listCases().then((result) => result.cases), []);
  const [query, setQuery] = useState('');

  return (
    <ResourceList
      heading={<PageHeading eyebrow="Cases" title="All cases" />}
      error={error}
      data={cases}
      errorMessage="Failed to load cases."
      loadingMessage="Loading cases…"
      emptyMessage="No cases yet."
    >
      {(cases) => {
        const filtered = cases.filter((caseRecord) => matchesQuery(caseRecord, query));
        return (
          <>
            <div className="list-toolbar">
              <TextInput
                id="case-filter"
                name="caseFilter"
                type="text"
                aria-label="Filter cases by client or external reference"
                placeholder="Filter by client or external reference"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className="list-count">
                {filtered.length} of {cases.length} {cases.length === 1 ? 'case' : 'cases'}
              </span>
            </div>

            <div className="data-card">
              <Table bordered fullWidth fixed className="case-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Status</th>
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
