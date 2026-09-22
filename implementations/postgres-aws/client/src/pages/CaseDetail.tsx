import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert, Table } from '@trussworks/react-uswds';
import { ApiError, getCase } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { RecordTable } from '../components/RecordTable';

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: detail, error } = useApiResource(() => getCase(caseId as string), [caseId]);

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Case not found.' : 'Failed to load case.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!detail) {
    return <p>Loading case…</p>;
  }

  return (
    <div>
      <RouterLink to="/">&larr; Back to cases</RouterLink>
      <h1>
        {detail.case.clientDisplayName ?? 'Case'} ({detail.case.caseId})
      </h1>

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
      <RecordTable
        rows={detail.participants}
        rowKey={(participant) => participant.caseParticipantId}
        columns={[
          { header: 'Person', render: (p) => p.personDisplayName ?? p.personId },
          { header: 'Role', render: (p) => p.participantRoleId },
          { header: 'Started', render: (p) => p.startedAt },
          { header: 'Ended', render: (p) => p.endedAt ?? '—' },
        ]}
      />

      <h2>Lifecycle history</h2>
      <RecordTable
        rows={detail.lifecycleEvents}
        rowKey={(event) => event.caseLifecycleEventId}
        columns={[
          { header: '#', render: (e) => e.sequenceNumber },
          { header: 'Effective', render: (e) => e.effectiveAt },
          { header: 'Recorded', render: (e) => e.recordedAt },
          { header: 'Resulting status', render: (e) => e.resultingStatusId },
        ]}
      />

      <h2>Identifiers</h2>
      <RecordTable
        rows={detail.identifiers}
        rowKey={(identifier) => identifier.caseIdentifierId}
        columns={[
          { header: 'Issuer', render: (i) => i.issuer },
          { header: 'Value', render: (i) => i.value },
          { header: 'Primary', render: (i) => (i.isPrimary ? 'Yes' : 'No') },
        ]}
      />
    </div>
  );
}
