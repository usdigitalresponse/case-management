import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Table } from '@trussworks/react-uswds';
import { ApiError, listCases, type CaseRecord } from '../api/client';
import { useAuth } from '../AuthContext';

export default function CaseList() {
  const { user, loading: authLoading } = useAuth();
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    listCases()
      .then((result) => setCases(result.cases))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? `Failed to load cases (${err.status}).` : 'Failed to load cases.');
      });
  }, [user]);

  if (authLoading) {
    return null;
  }

  if (!user) {
    return <Alert type="info">Sign in to view cases.</Alert>;
  }

  if (error) {
    return <Alert type="error">{error}</Alert>;
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
