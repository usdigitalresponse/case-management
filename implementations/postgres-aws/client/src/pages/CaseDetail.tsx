import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert } from '@trussworks/react-uswds';
import { ApiError, getCase, getCaseInvoices } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { RecordTable } from '../components/RecordTable';
import { PageHeading } from '../components/PageHeading';
import { formatDateTime } from '../formatDateTime';

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data: detail, error } = useApiResource(() => getCase(caseId as string), [caseId]);
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
      <PageHeading eyebrow="Case" title={detail.case.clientDisplayName ?? 'Case'} description={detail.case.caseId} />

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
            { header: 'Total', render: (i) => `$${i.submittedTotal}` },
            { header: 'Status', render: (i) => <span className="status-pill">{i.statusDisplayName}</span> },
          ]}
        />
      </div>
    </div>
  );
}
