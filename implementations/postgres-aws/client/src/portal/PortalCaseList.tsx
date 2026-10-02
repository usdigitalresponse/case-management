import { Link as RouterLink } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { listMyCases } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

export default function PortalCaseList() {
  const { data, error } = useApiResource(() => listMyCases().then((result) => result.cases), []);

  if (error) {
    return <Alert type="error">Failed to load your cases.</Alert>;
  }
  if (!data) {
    return <p>Loading…</p>;
  }
  if (data.length === 0) {
    return <p>You aren't assigned to any cases yet.</p>;
  }

  return (
    <ul className="portal-case-list">
      {data.map((caseRecord) => (
        <li key={caseRecord.caseId}>
          <RouterLink to={`/portal/cases/${caseRecord.caseId}`}>
            {caseRecord.externalReference ?? caseRecord.caseId}
          </RouterLink>
        </li>
      ))}
    </ul>
  );
}
