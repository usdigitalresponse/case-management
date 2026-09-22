import { useEffect, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert, Table } from '@trussworks/react-uswds';
import { ApiError, getCase, type CaseDetail as CaseDetailData } from '../api/client';
import { useAuth } from '../AuthContext';

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const { user, loading: authLoading } = useAuth();
  const [detail, setDetail] = useState<CaseDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !caseId) {
      return;
    }
    getCase(caseId)
      .then(setDetail)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setError('Case not found.');
          return;
        }
        setError('Failed to load case.');
      });
  }, [user, caseId]);

  if (authLoading) {
    return null;
  }
  if (!user) {
    return <Alert type="info">Sign in to view this case.</Alert>;
  }
  if (error) {
    return <Alert type="error">{error}</Alert>;
  }
  if (!detail) {
    return <p>Loading case…</p>;
  }

  return (
    <div>
      <RouterLink to="/">&larr; Back to cases</RouterLink>
      <h1>{detail.case.clientDisplayName ?? 'Case'} ({detail.case.caseId})</h1>

      <h2>Case</h2>
      <Table bordered>
        <tbody>
          <tr>
            <th scope="row">Status</th>
            <td>{detail.case.statusId}</td>
          </tr>
          <tr>
            <th scope="row">Opened</th>
            <td>{detail.case.openedOn ?? '—'}</td>
          </tr>
          <tr>
            <th scope="row">External reference</th>
            <td>{detail.case.externalReference ?? '—'}</td>
          </tr>
        </tbody>
      </Table>

      <h2>Participants</h2>
      {detail.participants.length === 0 ? (
        <p>None.</p>
      ) : (
        <Table bordered fullWidth>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Started</th>
              <th scope="col">Ended</th>
            </tr>
          </thead>
          <tbody>
            {detail.participants.map((participant) => (
              <tr key={participant.caseParticipantId}>
                <td>{participant.personDisplayName ?? participant.personId}</td>
                <td>{participant.participantRoleId}</td>
                <td>{participant.startedAt}</td>
                <td>{participant.endedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <h2>Lifecycle history</h2>
      {detail.lifecycleEvents.length === 0 ? (
        <p>None.</p>
      ) : (
        <Table bordered fullWidth>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Effective</th>
              <th scope="col">Recorded</th>
              <th scope="col">Resulting status</th>
            </tr>
          </thead>
          <tbody>
            {detail.lifecycleEvents.map((event) => (
              <tr key={event.caseLifecycleEventId}>
                <td>{event.sequenceNumber}</td>
                <td>{event.effectiveAt}</td>
                <td>{event.recordedAt}</td>
                <td>{event.resultingStatusId}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <h2>Identifiers</h2>
      {detail.identifiers.length === 0 ? (
        <p>None.</p>
      ) : (
        <Table bordered fullWidth>
          <thead>
            <tr>
              <th scope="col">Issuer</th>
              <th scope="col">Value</th>
              <th scope="col">Primary</th>
            </tr>
          </thead>
          <tbody>
            {detail.identifiers.map((identifier) => (
              <tr key={identifier.caseIdentifierId}>
                <td>{identifier.issuer}</td>
                <td>{identifier.value}</td>
                <td>{identifier.isPrimary ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
