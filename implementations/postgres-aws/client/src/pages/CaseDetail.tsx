import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  apiErrorMessage,
  setCaseReviewer,
  setPreauthorizedAmount,
  type AssignedPerson,
  type CaseDetail as CaseDetailRecord,
  type PreauthorizationSummary,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { caseDetail, caseInvoices } from '../resources';
import { DECIDED_STATUS_CODES, InvoiceStatus } from '../components/Completion';
import { CaseRateTable } from '../components/CaseRates';
import { CloseCaseAction } from '../components/CloseCaseAction';
import { PageHeader } from '../components/PageHeader';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { RecordTable } from '../components/RecordTable';
import { FlagNotes, FromCell, openInvoiceColumn, QuestionChips } from '../components/InvoiceCells';
import { ReviewerSelect, useReviewPeople } from '../components/ReviewRouting';
import { StatusPill } from '../components/StatusPill';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatDate, formatPeriod, formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { stageLabel } from '../overviewStages';

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

// What is pre-authorized, approved and waiting, with what would be left (design I49).
function PreauthorizedBilled({ summary, name }: { summary: PreauthorizationSummary; name: string | null }) {
  const ceiling = Number(summary.ceiling);
  const approved = Number(summary.approvedSoFar);
  const waiting = Number(summary.waiting);
  const left = ceiling - approved - waiting;
  const share = (amount: number) => `${ceiling > 0 ? Math.min(100, Math.max(0, (amount / ceiling) * 100)) : 0}%`;
  return (
    <div className="preauth-billed">
      <dl>
        <div>
          <dt>
            {summary.source === 'threshold' ? 'Threshold' : 'Pre-authorized'}
            {name ? ` for ${name}` : ' for the case'}
          </dt>
          <dd>{formatMoney(summary.ceiling)}</dd>
        </div>
        <div>
          <dt>Approved so far</dt>
          <dd className="total-figure--good">{formatMoney(summary.approvedSoFar)}</dd>
        </div>
        <div>
          <dt>Waiting for a decision</dt>
          <dd>{formatMoney(summary.waiting)}</dd>
        </div>
        <div>
          <dt>{left < 0 ? 'Over if everything waiting is approved' : 'Left if everything waiting is approved'}</dt>
          <dd className={left < 0 ? 'total-figure--cut' : undefined}>{formatMoney(Math.abs(left))}</dd>
        </div>
      </dl>
      <div className="preauth-bar" aria-hidden="true">
        <span className="preauth-bar__approved" style={{ width: share(approved) }} />
        <span className="preauth-bar__waiting" style={{ width: share(waiting) }} />
      </div>
      <p className="cell-note">Green is approved, blue is waiting for a decision.</p>
    </div>
  );
}

// Any staff member enters a pre-authorized amount, or changes one; earlier amounts are kept.
function PreauthorizedAmount({ caseId, people, onSaved }: {
  caseId: string;
  people: Array<{ professionalId: string; name: string }>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [forWhom, setForWhom] = useState('');
  const [amount, setAmount] = useState('');
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn--outline" onClick={() => setOpen(true)}>
        Set a pre-authorized amount
      </button>
    );
  }
  return (
    <form
      className="inline-fields preauth-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setPreauthorizedAmount(caseId, { professionalId: forWhom || null, amount: Number(amount), authorizationNumber: number.trim() || undefined }).then(
          () => {
            setOpen(false);
            setAmount('');
            setNumber('');
            setSaving(false);
            onSaved();
          },
          (err: unknown) => {
            setError(apiErrorMessage(err, 'The amount could not be saved.'));
            setSaving(false);
          },
        );
      }}
    >
      <div className="usa-form-group">
        <label className="usa-label" htmlFor="preauth-for">For</label>
        <select id="preauth-for" className="usa-select" value={forWhom} onChange={(event) => setForWhom(event.target.value)}>
          <option value="">The whole case</option>
          {people.map((person) => (
            <option key={person.professionalId} value={person.professionalId}>{person.name}</option>
          ))}
        </select>
      </div>
      <div className="usa-form-group">
        <label className="usa-label" htmlFor="preauth-amount">Amount</label>
        <input id="preauth-amount" className="usa-input" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </div>
      <div className="usa-form-group">
        <label className="usa-label" htmlFor="preauth-number">Authorization number (optional)</label>
        <input id="preauth-number" className="usa-input" value={number} onChange={(event) => setNumber(event.target.value)} />
      </div>
      <button type="submit" className="btn btn--primary" disabled={saving || !(Number(amount) > 0)}>Save</button>
      <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancel</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
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
  const { data: detail, error } = useApiResource(caseDetail(caseId as string), [caseId, refreshKey]);
  const {
    data: billing,
    error: billingError,
    reload: reloadBilling,
  } = useApiResource(caseInvoices(caseId as string), [caseId, refreshKey]);

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
        crumbs={[{ label: 'All cases', to: '/cases' }, { label: detail.case.clientDisplayName ?? 'Case' }, { label: caseNumber }]}
        title={detail.case.clientDisplayName ?? 'Case'}
        status={<StatusPill label={stageLabel(detail.case.stage)} />}
        actions={
          <button type="button" className="btn btn--outline" disabled title="Not connected yet">
            Open in your {EXTERNAL_SYSTEM_NAME} ↗
          </button>
        }
      />
      <p className="page-description">
        Cases may be managed in your {EXTERNAL_SYSTEM_NAME}. They show here so invoices make sense.
      </p>

      <FactsStrip>
        <Fact label="Case number" note={billing?.otherCaseNumbers.length ? billing.otherCaseNumbers.join(', ') : undefined}>
          <strong>{caseNumber}</strong>
        </Fact>
        <Fact label="Opened">
          <strong>{detail.case.openedOn ? formatDate(detail.case.openedOn) : '—'}</strong>
        </Fact>
        <Fact label="County">
          <strong>{detail.case.countyDisplayName ?? '—'}</strong>
        </Fact>
        <Fact label="Who reviews its invoices" note="Change in Settings or here">
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

      <div className="case-columns">
        <section className="compact-card">
          <div className="section-heading-row">
            <h2>Pre-authorized and billed</h2>
            <Link to={`/preauthorizations?status=&caseId=${detail.case.caseId}`}>Requests on this case</Link>
          </div>
          {billing && billing.preauthorizations.length === 0 && <p className="muted">Nothing pre-authorized yet.</p>}
          {billing?.preauthorizations.map((summary) => (
            <PreauthorizedBilled
              key={summary.professionalId ?? 'case'}
              summary={summary}
              name={summary.professionalId ? (professionalNames.get(summary.professionalId) ?? null) : null}
            />
          ))}
          {user?.reviewPermissions?.reviewLines && (
            <PreauthorizedAmount
              caseId={detail.case.caseId}
              people={activeAssignments.map((assignment) => ({
                professionalId: assignment.professionalId,
                name: assignment.professionalDisplayName ?? 'Unknown',
              }))}
              onSaved={refresh}
            />
          )}
        </section>
        <section className="compact-card">
          <h2>People on this case</h2>
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

      <section className="compact-card">
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
              {
                header: 'From',
                render: (invoice) => (
                  <>
                    <FromCell invoice={invoice} />
                    <FlagNotes invoice={invoice} />
                  </>
                ),
              },
              { header: 'Billing period', render: (invoice) => formatPeriod(invoice.periodStart, invoice.periodEnd) },
              { header: 'Submitted', render: (invoice) => (invoice.submittedAt ? formatDay(invoice.submittedAt) : '—') },
              { header: 'Requested', render: (invoice) => formatMoney(invoice.submittedTotal) },
              {
                header: 'Approved',
                render: (invoice) => (DECIDED_STATUS_CODES.includes(invoice.statusCode) ? formatMoney(invoice.approvedTotal ?? 0) : 'None yet'),
              },
              {
                header: 'Status',
                render: (invoice) => (
                  <>
                    <InvoiceStatus invoice={invoice} onCompleted={reloadBilling} />
                    <QuestionChips invoice={invoice} />
                  </>
                ),
              },
              openInvoiceColumn((invoice) => (DECIDED_STATUS_CODES.includes(invoice.statusCode) ? 'View' : 'Review')),
            ]}
          />
        )}
      </section>

      <section className="compact-card">
        <h2>Case rates</h2>
        <p className="compact-hint">Reviewers set these while reviewing the case's invoices. A new rate is added; earlier ones stay.</p>
        {billing && <CaseRateTable rows={billing.caseRates} label="Case rates" />}
      </section>

      <CloseHere detail={detail} onClosed={refresh} />
    </div>
  );
}

// A cleanup, not a step every case needs: the case's real status lives in the
// external system, and a later invoice matched to it reopens it.
function CloseHere({ detail, onClosed }: { detail: CaseDetailRecord; onClosed: () => void }) {
  const { waiting, notCompleted } = detail.unfinishedInvoices;
  let body;
  if (detail.case.closedOn) {
    body = <p className="compact-hint">Closed here on {formatDate(detail.case.closedOn)}. Matching a new invoice to it reopens it.</p>;
  } else if (waiting > 0 || notCompleted > 0) {
    body = (
      <p className="compact-hint">
        You can close it here once its invoices are finished.{' '}
        {[
          waiting > 0 ? `${waiting} ${waiting === 1 ? 'is' : 'are'} in review` : null,
          notCompleted > 0 ? `${notCompleted} decided ${notCompleted === 1 ? 'isn’t' : 'aren’t'} marked completed` : null,
        ]
          .filter(Boolean)
          .join(', and ')}
        .
      </p>
    );
  } else {
    body = (
      <>
        <p className="compact-hint">
          Its status lives in your {EXTERNAL_SYSTEM_NAME}. Closing it here only takes it off the open lists and ends who's on it; a
          new invoice matched to it reopens it.
        </p>
        <CloseCaseAction caseId={detail.case.caseId} onClosed={onClosed} />
      </>
    );
  }
  return (
    <section className="compact-card close-here">
      <h2>Closing the case here</h2>
      {body}
    </section>
  );
}
