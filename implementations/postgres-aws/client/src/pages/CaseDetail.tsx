import { useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import {
  ApiError,
  apiErrorMessage,
  getCase,
  getCaseInvoices,
  listReviewPeople,
  setCaseReviewer,
  type AssignedPerson,
  type PreauthorizationSummary,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { StatusPill } from '../components/StatusPill';
import { AddPersonToCase } from '../components/AddPersonToCase';
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
  const { data } = useApiResource(() => (editing ? listReviewPeople() : Promise.resolve(null)), [editing]);
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
      <select
        id="case-reviewer"
        className="usa-select settings-role"
        defaultValue={reviewer?.userAccountId ?? ''}
        onChange={(event) => {
          setError(null);
          setCaseReviewer(caseId, event.target.value).then(
            () => {
              setEditing(false);
              onChanged();
            },
            (err: unknown) => setError(apiErrorMessage(err, 'Could not change the reviewer.')),
          );
        }}
      >
        <option value="" disabled>Choose a reviewer</option>
        {data?.people.filter((person) => person.reviewsLines).map((person) => (
          <option key={person.userAccountId} value={person.userAccountId}>{person.displayName}</option>
        ))}
      </select>
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

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Case not found.' : 'Failed to load case.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!detail) {
    return <p role="status">Loading case…</p>;
  }

  const activeAssignments = detail.assignments.filter((assignment) => !assignment.endedAt);
  const professionalNames = new Map(detail.assignments.map((a) => [a.professionalId, a.professionalDisplayName]));

  return (
    <div>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <RouterLink to="/cases">Cases</RouterLink>
        <span aria-hidden="true">›</span>
        <span>{detail.case.clientDisplayName ?? 'Case'}</span>
      </nav>
      <div className="page-title-row">
        <div>
          <h1>{detail.case.clientDisplayName ?? 'Case'}</h1>
          <p className="title-meta">
            <strong>Case {billing?.caseNumber ?? detail.case.externalReference ?? '—'}</strong>
            {billing && billing.otherCaseNumbers.length > 0 && <span>{billing.otherCaseNumbers.join(', ')}</span>}
            {detail.case.openedOn && <span>Opened {formatDate(detail.case.openedOn)}</span>}
          </p>
        </div>
        <button type="button" className="btn btn--outline" disabled title="Not connected yet">
          Open the case in your {EXTERNAL_SYSTEM_NAME} ↗
        </button>
      </div>

      <div className="notice notice--info">
        Cases may be managed in your {EXTERNAL_SYSTEM_NAME}. They show here so invoices make sense. Add people here only so
        they can submit invoices on this case.
      </div>

      <dl className="facts-strip">
        <div>
          <dt>Case number</dt>
          <dd>{billing?.caseNumber ?? detail.case.externalReference ?? '—'}</dd>
        </div>
        <div>
          <dt>Other numbers</dt>
          <dd>{billing?.otherCaseNumbers.join(', ') || 'None'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{detail.case.statusDisplayName}</dd>
        </div>
        <div>
          <dt>Professionals</dt>
          <dd>{activeAssignments.map((a) => a.professionalDisplayName).filter(Boolean).join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>Pre-authorized</dt>
          <dd>
            {billing && billing.preauthorizations.length > 0
              ? formatMoney(billing.preauthorizations.reduce((sum, p) => sum + Number(p.ceiling), 0))
              : 'None'}
          </dd>
        </div>
        <div>
          <dt>Who reviews its invoices</dt>
          <dd>
            {billing && (
              <CaseReviewer
                caseId={detail.case.caseId}
                reviewer={billing.reviewer}
                canChange={Boolean(user?.reviewPermissions?.reassign)}
                onChanged={refresh}
              />
            )}
          </dd>
        </div>
      </dl>

      <section className="detail-section">
        <h2>Invoices on this case</h2>
        {Boolean(billingError) && <Alert type="error">Failed to load invoices.</Alert>}
        {billing && billing.invoices.length === 0 && <p className="empty-note">No invoices submitted yet.</p>}
        {billing && billing.invoices.length > 0 && (
          <div className="data-card">
            <table className="usa-table queue-table">
              <thead>
                <tr>
                  <th scope="col">Submitted</th>
                  <th scope="col">From</th>
                  <th scope="col" className="amount">Requested</th>
                  <th scope="col" className="amount">Approved</th>
                  <th scope="col">Decided</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reviewer</th>
                  <th scope="col"><span className="usa-sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {billing.invoices.map((invoice) => (
                  <tr key={invoice.invoiceId}>
                    <td>{invoice.submittedAt ? formatDate(invoice.submittedAt.slice(0, 10)) : '—'}</td>
                    <td>
                      {invoice.professionalDisplayName ?? '—'}
                      {invoice.professionalKindDisplayName && `, ${invoice.professionalKindDisplayName.toLowerCase()}`}
                      {invoice.flags.map((flag) => <span key={flag.kind} className="cell-flag">{flag.message}</span>)}
                    </td>
                    <td className="amount"><strong>{formatMoney(invoice.submittedTotal)}</strong></td>
                    <td className="amount">{formatMoney(invoice.approvedTotal ?? 0)}</td>
                    <td>{invoice.decidedCount} of {invoice.lineCount}</td>
                    <td><StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /></td>
                    <td>{invoice.reviewer?.displayName ?? <span className="muted">Not assigned</span>}</td>
                    <td>
                      <RouterLink className="row-action" to={`/billing/${invoice.invoiceId}`}>
                        {['approved', 'rejected'].includes(invoice.statusCode) ? 'View' : 'Review'} <span aria-hidden="true">→</span>
                      </RouterLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <div className="data-card">
          <table className="usa-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role on the case</th>
                <th scope="col">Since</th>
              </tr>
            </thead>
            <tbody>
              {detail.participants.filter((p) => !p.endedAt).map((participant) => (
                <tr key={participant.caseParticipantId}>
                  <th scope="row">{participant.personDisplayName ?? 'Unnamed person'}</th>
                  <td>{participant.participantRoleDisplayName}</td>
                  <td>{formatDate(participant.startedAt.slice(0, 10))}</td>
                </tr>
              ))}
              {activeAssignments.map((assignment) => (
                <tr key={assignment.caseAssignmentId}>
                  <th scope="row">{assignment.professionalDisplayName ?? 'Unknown'}</th>
                  <td>{assignment.assignmentRoleDisplayName}</td>
                  <td>{formatDate(assignment.assignedAt.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
