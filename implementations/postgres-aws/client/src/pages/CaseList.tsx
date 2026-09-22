import { Link as RouterLink } from 'react-router-dom';
import { Alert, Table } from '@trussworks/react-uswds';
import { listCases } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

export default function CaseList() {
  const { data: cases, error } = useApiResource(() => listCases().then((result) => result.cases), []);

  if (error) {
    return <Alert type="error">Failed to load cases.</Alert>;
  }

  if (!cases) {
    return <p>Loading cases…</p>;
  }

  if (cases.length === 0) {
    return <p>No cases yet.</p>;
  }

  return (
    <Table bordered fullWidth>
      <thead>
        <tr>
          <th scope="col">Client</th>
          <th scope="col">Case ID</th>
          <th scope="col">Status</th>
          <th scope="col">Opened</th>
          <th scope="col">External reference</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((caseRecord) => (
          <tr key={caseRecord.caseId}>
            <th scope="row">
              <RouterLink to={`/cases/${caseRecord.caseId}`}>
                {caseRecord.clientDisplayName ?? caseRecord.caseId}
              </RouterLink>
            </th>
            <td>{caseRecord.caseId}</td>
            <td>{caseRecord.statusId}</td>
            <td>{caseRecord.openedOn ?? '—'}</td>
            <td>{caseRecord.externalReference ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
