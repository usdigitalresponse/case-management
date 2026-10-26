import { useState } from 'react';
import { useParams } from 'react-router';
import {
  apiErrorMessage,
  getCase,
  getCaseInvoices,
  setCaseReviewer,
  type AssignedPerson,
  type PreauthorizationSummary,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { StatusPill } from '../components/StatusPill';
import { AddPersonToCase } from '../components/AddPersonToCase';
import { PageHeader } from '../components/PageHeader';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { FlagNotes, FromCell, openInvoiceColumn } from '../components/InvoiceCells';
import { ReviewerSelect, useReviewPeople } from '../components/ReviewRouting';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

// Who reviews this case's new invoices, ahead of the default in Settings.
function CaseReviewer({ caseId, reviewer, canChange, onChanged }: {
  caseId: string;
  reviewer: AssignedPerson | null;
  canChange: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const people = useReviewPeople(editing);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <>
        {reviewer?.displayName ?? 'The default reviewer'}
        {canChange && (
          <button type="button" className="link-button cell-note" onClick={() => setEditing(true)}>Change</button>
        )}
      </>
    );
  }
  return (
    <>
      <label className="usa-sr-only" htmlFor="case-reviewer">Who reviews this case's invoices</label>
      <ReviewerSelect
        id="case-reviewer"
        people={people ?? []}
        value={reviewer?.userAccountId ?? ''}
        onChange={(userAccountId) => {
          setError(null);
          setCaseReviewer(caseId, userAccountId).then(
            () => {
              setEditing(false);
              onChanged();
            },
            (err: unknown) => setError(apiErrorMessage(err, 'Could not change the reviewer.')),
          );
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </>
  );
}

function PreauthorizationLine({ summary, name }: { summary: PreauthorizationSummary; name: string | null }) {
  return (
    <p className="preauth-line">
      <span>Pre-authorized{name ? ` for ${name}` : ''}: {formatMoney(summary.ceiling)}</span>
      <span>Approved so far: {formatMoney(summary.approvedSoFar)}</span>
      <strong>Waiting for a decision: {formatMoney(summary.waiting)}</strong>
    </p>
  );
}

// The case as this tool sees it: mostly read-only, since cases may be
// managed in an external system. Invoices on the case and who may submit
// them are what matter here.
export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((key) => key + 1);
  const { data: detail, error } = useApiResource(() => getCase(caseId as string), [caseId, refreshKey]);
  const { data: billing, error: billingError } = useApiResource(() => getCaseInvoices(caseId as string), [caseId, refreshKey]);

  if (error || !detail) {
    return <LoadState error={error} what="case" />;
  }

  const activeAssignments = detail.assignments.filter((assignment) => !assignment.endedAt);
  const professionalNames = new Map(detail.assignments.map((a) => [a.professionalId, a.professionalDisplayName]));
  const caseNumber = billing?.caseNumber ?? detail.case.externalReference ?? '—';
  const people = [
    ...detail.participants
      .filter((participant) => !participant.endedAt)
      .map((participant) => ({
        key: participant.caseParticipantId,
        name: participant.personDisplayName ?? 'Unnamed person',
        role: participant.participantRoleDisplayName,
        since: participant.startedAt,
      })),
    ...activeAssignments.map((assignment) => ({
      key: assignment.caseAssignmentId,
      name: assignment.professionalDisplayName ?? 'Unknown',
      role: assignment.assignmentRoleDisplayName,
      since: assignment.assignedAt,
    })),
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Cases', to: '/cases' }, { label: detail.case.clientDisplayName ?? 'Case' }]}
        title={detail.case.clientDisplayName ?? 'Case'}
        meta={
          <>
            <strong>Case {caseNumber}</strong>
            {billing && billing.otherCaseNumbers.length > 0 && <span>{billing.otherCaseNumbers.join(', ')}</span>}
            {detail.case.openedOn && <span>Opened {formatDate(detail.case.openedOn)}</span>}
          </>
        }
        actions={
          <button type="button" className="btn btn--outline" disabled title="Not connected yet">
            Open the case in your {EXTERNAL_SYSTEM_NAME} ↗
          </button>
        }
      />

      <Notice tone="info">
        Cases may be managed in your {EXTERNAL_SYSTEM_NAME}. They show here so invoices make sense. Add people here only so
        they can submit invoices on this case.
      </Notice>

      <FactsStrip>
        <Fact label="Case number">{caseNumber}</Fact>
        <Fact label="Other numbers">{billing?.otherCaseNumbers.join(', ') || 'None'}</Fact>
        <Fact label="Status">{detail.case.statusDisplayName}</Fact>
        <Fact label="Professionals">{activeAssignments.map((a) => a.professionalDisplayName).filter(Boolean).join(', ') || '—'}</Fact>
        <Fact label="Pre-authorized">
          {billing && billing.preauthorizations.length > 0
            ? formatMoney(billing.preauthorizations.reduce((sum, p) => sum + Number(p.ceiling), 0))
            : 'None'}
        </Fact>
        <Fact label="Who reviews its invoices">
          {billing && (
            <CaseReviewer
              caseId={detail.case.caseId}
              reviewer={billing.reviewer}
              canChange={Boolean(user?.reviewPermissions?.reassign)}
              onChanged={refresh}
            />
          )}
        </Fact>
      </FactsStrip>

      <section className="detail-section">
        <h2>Invoices on this case</h2>
        {Boolean(billingError) && <Notice tone="danger">Failed to load invoices.</Notice>}
        {billing && (
          <RecordTable
            className="queue-table"
            label="Invoices on this case"
            rows={billing.invoices}
            rowKey={(invoice) => invoice.invoiceId}
            emptyMessage="No invoices submitted yet."
            columns={[
              { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—') },
              {
                header: 'From',
                render: (invoice) => (
                  <>
                    <FromCell invoice={invoice} />
                    <FlagNotes invoice={invoice} />
                  </>
                ),
              },
              { header: 'Requested', align: 'right', render: (invoice) => <strong>{formatMoney(invoice.submittedTotal)}</strong> },
              { header: 'Approved', align: 'right', render: (invoice) => formatMoney(invoice.approvedTotal ?? 0) },
              { header: 'Decided', render: (invoice) => `${invoice.decidedCount} of ${invoice.lineCount}` },
              { header: 'Status', render: (invoice) => <StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /> },
              { header: 'Reviewer', render: (invoice) => invoice.reviewer?.displayName ?? <span className="muted">Not assigned</span> },
              openInvoiceColumn((invoice) => (['approved', 'rejected'].includes(invoice.statusCode) ? 'View' : 'Review')),
            ]}
          />
        )}
        {billing?.preauthorizations.map((summary) => (
          <PreauthorizationLine
            key={summary.professionalId ?? 'case'}
            summary={summary}
            name={summary.professionalId ? (professionalNames.get(summary.professionalId) ?? null) : null}
          />
        ))}
      </section>

      <section className="detail-section">
        <div className="section-heading-row">
          <h2>People on this case</h2>
          {!detail.case.closedOn && <AddPersonToCase caseId={detail.case.caseId} onAdded={refresh} />}
        </div>
        <RecordTable
          label="People on this case"
          rows={people}
          rowKey={(person) => person.key}
          emptyMessage="No one is on this case yet."
          columns={[
            { header: 'Person', rowHeader: true, render: (person) => person.name },
            { header: 'Role on the case', render: (person) => person.role },
            { header: 'Since', render: (person) => formatDate(person.since.slice(0, 10)) },
          ]}
        />
      </section>
    </div>
  );
}
