import { Link as RouterLink } from 'react-router';
import { listMyCases } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { ResourceList } from '../components/ResourceList';
import { caseDisplayLabel } from '../caseDisplayLabel';

export default function PortalCaseList() {
  const { data, error } = useApiResource(() => listMyCases().then((result) => result.cases), []);

  return (
    <ResourceList
      heading={<PageHeading eyebrow="Your cases" title="Cases assigned to you" />}
      error={error}
      data={data}
      errorMessage="Failed to load your cases."
      emptyMessage="You aren't assigned to any cases yet."
    >
      {(cases) => (
        <ul className="portal-case-cards">
          {cases.map((caseRecord) => (
            <li key={caseRecord.caseId}>
              <RouterLink className="row-card" to={`/portal/cases/${caseRecord.caseId}`}>
                <span className="row-card-title">
                  {caseDisplayLabel(
                    [caseRecord.externalReference, caseRecord.clientDisplayName],
                    { label: 'Case assigned', date: caseRecord.assignedAt },
                  )}
                </span>
                <span className="row-card-meta">
                  <span className="status-pill">{caseRecord.statusDisplayName}</span>
                  <span>Assigned {caseRecord.assignedAt.slice(0, 10)}</span>
                </span>
              </RouterLink>
            </li>
          ))}
        </ul>
      )}
    </ResourceList>
  );
}
