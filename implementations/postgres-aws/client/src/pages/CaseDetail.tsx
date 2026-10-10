import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { ApiError, getCase, getCaseInvoices } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { RecordTable } from '../components/RecordTable';
import { PageHeading } from '../components/PageHeading';
import { AssignStaffForm } from '../components/AssignStaffForm';
import { CloseCaseAction } from '../components/CloseCaseAction';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { StatusPill } from '../components/StatusPill';

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  // Bumped after an assignment or closure to re-run getCase, since
  // useApiResource only refetches when one of its deps changes.
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: detail, error } = useApiResource(() => getCase(caseId as string), [caseId, refreshKey]);
  const { data: invoices, error: invoicesError } = useApiResource(
    () => getCaseInvoices(caseId as string).then((r) => r.invoices),
    [caseId],
  );

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Case not found.' : 'Failed to load case.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!detail) {
    return <p role="status">Loading case…</p>;
  }

  return (
    <div>
      <RouterLink to="/cases">&larr; Back to cases</RouterLink>
      <div className="case-heading-row">
        <PageHeading eyebrow="Case" title={detail.case.clientDisplayName ?? 'Case'} description={detail.case.caseId} />
        {!detail.case.closedOn && (
          <CloseCaseAction caseId={detail.case.caseId} onClosed={() => setRefreshKey((key) => key + 1)} />
        )}
      </div>

      <dl className="fact-grid">
        <div className="fact">
          <dt>Status</dt>
          <dd><span className="status-pill">{detail.case.statusDisplayName}</span></dd>
        </div>
        <div className="fact">
          <dt>Opened</dt>
          <dd>{detail.case.openedOn ?? '—'}</dd>
        </div>
        <div className="fact">
          <dt>External reference</dt>
          <dd>{detail.case.externalReference ?? '—'}</dd>
        </div>
      </dl>

      <div className="detail-section">
        <h2>Participants</h2>
        <RecordTable
          rows={detail.participants}
          rowKey={(participant) => participant.caseParticipantId}
          columns={[
            { header: 'Person', render: (p) => p.personDisplayName ?? 'Unnamed person' },
            { header: 'Role', render: (p) => p.participantRoleDisplayName },
            { header: 'Started', render: (p) => formatDateTime(p.startedAt) },
            { header: 'Ended', render: (p) => (p.endedAt ? formatDateTime(p.endedAt) : '—') },
          ]}
        />
      </div>

      <div className="detail-section">
        <h2>Assignments</h2>
        <RecordTable
          rows={detail.assignments}
          rowKey={(assignment) => assignment.caseAssignmentId}
          emptyMessage="No one is assigned to this case yet."
          columns={[
            { header: 'Assigned to', render: (a) => a.professionalDisplayName ?? 'Unknown' },
            { header: 'Role', render: (a) => a.assignmentRoleDisplayName },
            { header: 'Assigned', render: (a) => formatDateTime(a.assignedAt) },
            { header: 'Ended', render: (a) => (a.endedAt ? formatDateTime(a.endedAt) : '—') },
          ]}
        />
        {!detail.case.closedOn && (
          <AssignStaffForm caseId={detail.case.caseId} onAssigned={() => setRefreshKey((key) => key + 1)} />
        )}
      </div>

      <div className="detail-section">
        <h2>Lifecycle history</h2>
        <RecordTable
          rows={detail.lifecycleEvents}
          rowKey={(event) => event.caseLifecycleEventId}
          columns={[
            { header: '#', render: (e) => e.sequenceNumber },
            { header: 'Effective', render: (e) => formatDateTime(e.effectiveAt) },
            { header: 'Recorded', render: (e) => formatDateTime(e.recordedAt) },
            { header: 'Resulting status', render: (e) => <span className="status-pill">{e.resultingStatusDisplayName}</span> },
          ]}
        />
      </div>

      <div className="detail-section">
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

      <div className="detail-section">
        <h2>Invoices</h2>
        {Boolean(invoicesError) && <Alert type="error">Failed to load invoices.</Alert>}
        <RecordTable
          rows={invoices ?? []}
          rowKey={(invoiceRecord) => invoiceRecord.invoiceId}
          emptyMessage="No invoices submitted yet."
          columns={[
            { header: 'Submitted', render: (i) => (i.submittedAt ? formatDateTime(i.submittedAt) : '—') },
            { header: 'Total', render: (i) => <span className="amount">{formatMoney(i.submittedTotal)}</span> },
            { header: 'Status', render: (i) => <StatusPill code={i.statusCode} label={i.statusDisplayName} /> },
            {
              header: 'Actions',
              render: (i) => (
                <RouterLink to={`/billing/${i.invoiceId}`}>{i.statusCode === 'submitted' ? 'Review' : 'View'}</RouterLink>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
