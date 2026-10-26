import { useState, type FormEvent } from 'react';
import { useParams, Link as RouterLink } from 'react-router';
import { Alert, Button, Checkbox, Form, FormGroup, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  createTimeEntry,
  deleteTimeEntry,
  listBillableProfessionals,
  listMyCases,
  listMyInvoices,
  listMyTimeEntries,
  rateOn,
  updateTimeEntry,
  type BillableProfessional,
  type TimeEntryRecord,
} from '../api/client';
import { professionalLabel } from '../components/InvoiceLinesEditor';
import { useApiResource } from '../hooks/useApiResource';
import { NewInvoiceForm } from './NewInvoiceForm';
import { RecordTable } from '../components/RecordTable';
import { PageHeading } from '../components/PageHeading';
import { StatusPill } from '../components/StatusPill';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { ConfirmButton } from '../components/ConfirmButton';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDate, formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

const BILLING_LABELS: Record<string, string> = {
  draft: 'On a draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

function BillingState({ entry }: { entry: TimeEntryRecord }) {
  if (!entry.billing) {
    return <span className="status-pill status-pill--pending">Unbilled</span>;
  }
  return (
    <RouterLink to={`/portal/invoices/${entry.billing.invoiceId}`}>
      {BILLING_LABELS[entry.billing.statusCode] ?? entry.billing.statusCode}
    </RouterLink>
  );
}

function RateNote({ billable }: { billable: BillableProfessional[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <p className="rate-note">
      Hourly rate today:{' '}
      {billable
        .map((professional) => {
          const rate = rateOn(professional.rates, today);
          const amount = rate ? formatMoney(rate) : 'not set';
          return billable.length > 1 ? `${professionalLabel(professional)} ${amount}` : amount;
        })
        .join(' · ')}
      . Set by administrators.
    </p>
  );
}

function TimeEntrySection({
  caseId,
  billable,
  entries,
  error,
  onLogged,
}: {
  caseId: string;
  billable: BillableProfessional[];
  entries: TimeEntryRecord[] | null;
  error: unknown;
  onLogged: () => void;
}) {
  // A delegate also sees and logs time for those they act for.
  const byId = new Map(billable.map((p) => [p.professionalId, p]));
  const workDoneBy = (professionalId: string) => {
    const professional = byId.get(professionalId);
    return professional ? professionalLabel(professional) : 'Unknown professional';
  };
  const data = entries;
  const unbilledCount = entries?.filter((entry) => !entry.billing && byId.has(entry.professionalId)).length ?? 0;

  const [professionalId, setProfessionalId] = useState(
    () => (billable.find((p) => p.isSelf) ?? billable[0])?.professionalId ?? '',
  );
  const [activityOn, setActivityOn] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [description, setDescription] = useState('');
  // The entry loaded into the form for editing, if any.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function startEditing(entry: TimeEntryRecord) {
    setRowError(null);
    setSubmitError(null);
    setEditingId(entry.timeEntryId);
    setProfessionalId(entry.professionalId);
    setActivityOn(entry.activityOn);
    setDurationHours(String(Number(entry.durationHours)));
    setDescription(entry.description);
  }

  async function remove(timeEntryId: string) {
    setRowError(null);
    try {
      await deleteTimeEntry(timeEntryId);
      onLogged();
    } catch (err) {
      setRowError(apiErrorMessage(err, 'The time entry could not be deleted.'));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    const values = { activityOn, durationHours: Number(durationHours), description };
    try {
      if (editingId) {
        await updateTimeEntry(editingId, values);
      } else {
        await createTimeEntry({ caseId, professionalId, ...values });
      }
      onLogged();
    } catch (err) {
      setSubmitError(
        apiErrorMessage(
          err,
          `The time could not be ${editingId ? 'saved' : 'logged'}. Check the date, hours (0.25 to 24) and description.`,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Time</h2>
      <RateNote billable={billable} />
      {Boolean(error) && <Alert type="error">Failed to load time entries.</Alert>}
      {rowError && <Alert type="warning" slim>{rowError}</Alert>}
      {unbilledCount > 0 && (
        <p className="compact-hint">
          {unbilledCount} {unbilledCount === 1 ? 'entry is' : 'entries are'} not on an invoice yet.{' '}
          <a href="#new-invoice">Invoice unbilled time</a>
        </p>
      )}
      {data && (
        <RecordTable
          rows={data}
          rowKey={(entry) => entry.timeEntryId}
          emptyMessage="No time logged yet."
          columns={[
            { header: 'Date', render: (e) => formatDate(e.activityOn) },
            ...(billable.length > 1 ? [{ header: 'Work done by', render: (e: TimeEntryRecord) => workDoneBy(e.professionalId) }] : []),
            { header: 'Hours', render: (e) => e.durationHours },
            { header: 'Description', render: (e) => e.description },
            { header: 'Billing', render: (e) => <BillingState entry={e} /> },
            {
              header: 'Actions',
              // Only time the user may record. Time on a draft is changed there;
              // on a submitted invoice, the buttons explain why not.
              render: (e) =>
                byId.has(e.professionalId) &&
                (e.billing?.statusCode === 'draft' ? (
                  <RouterLink to={`/portal/invoices/${e.billing.invoiceId}`}>Edit on draft</RouterLink>
                ) : (
                  <span className="row-actions">
                    <Button
                      type="button"
                      unstyled
                      onClick={() => (e.lockedReason ? setRowError(e.lockedReason) : startEditing(e))}
                    >
                      Edit
                    </Button>
                    {e.lockedReason ? (
                      <Button type="button" unstyled className="confirm-compact" onClick={() => setRowError(e.lockedReason)}>
                        Delete
                      </Button>
                    ) : (
                      <ConfirmButton
                        compact
                        label="Delete"
                        prompt="Delete this time entry?"
                        confirmLabel="Yes, delete"
                        onConfirm={() => void remove(e.timeEntryId)}
                      />
                    )}
                  </span>
                )),
            },
          ]}
        />
      )}

      <Form className="compact-form compact-card" onSubmit={(event) => void handleSubmit(event)}>
        <h3>{editingId ? 'Edit time' : 'Log time'}</h3>
        {submitError && <Alert type="error" slim>{submitError}</Alert>}
        <div className={`inline-fields time-entry-fields${billable.length > 1 ? ' time-entry-fields--with-professional' : ''}`}>
          {billable.length > 1 && (
            <FormGroup>
              <Label htmlFor="time-professional">Work done by</Label>
              <Select
                id="time-professional"
                name="professionalId"
                value={professionalId}
                disabled={editingId !== null}
                onChange={(event) => setProfessionalId(event.target.value)}
              >
                {billable.map((professional) => (
                  <option key={professional.professionalId} value={professional.professionalId}>
                    {professionalLabel(professional)}
                  </option>
                ))}
              </Select>
            </FormGroup>
          )}
          <FormGroup>
            <Label htmlFor="activity-on">Date</Label>
            <input
              id="activity-on"
              name="activityOn"
              type="date"
              className="usa-input"
              required
              value={activityOn}
              onChange={(event) => setActivityOn(event.target.value)}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor="duration-hours">Hours</Label>
            <TextInput
              id="duration-hours"
              name="durationHours"
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              required
              value={durationHours}
              onChange={(event) => setDurationHours(event.target.value)}
            />
          </FormGroup>
          <FormGroup>
            <Label htmlFor="time-description">Description</Label>
            <TextInput
              id="time-description"
              name="description"
              type="text"
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormGroup>
          <span className="row-actions">
            <Button type="submit" disabled={submitting || !activityOn || !durationHours || !description.trim()}>
              {editingId ? (submitting ? 'Saving…' : 'Save') : submitting ? 'Logging…' : 'Log time'}
            </Button>
            {editingId && (
              <Button type="button" unstyled onClick={onLogged}>
                Cancel
              </Button>
            )}
          </span>
        </div>
      </Form>
    </section>
  );
}

function InvoiceSection({
  caseId,
  billable,
  entries,
  onInvoiced,
}: {
  caseId: string;
  billable: BillableProfessional[];
  entries: TimeEntryRecord[] | null;
  // Billing changes what time is unbilled.
  onInvoiced: () => void;
}) {
  const [listVersion, setListVersion] = useState(0);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const { data, error } = useApiResource(() => listMyInvoices(caseId).then((result) => result.invoices), [caseId, listVersion]);
  const withdrawnCount = data?.filter((i) => i.statusCode === 'withdrawn').length ?? 0;

  return (
    <section>
      <h2>Invoices</h2>
      {Boolean(error) && <Alert type="error">Failed to load invoices.</Alert>}
      {data && withdrawnCount > 0 && (
        <Checkbox
          id="invoices-show-withdrawn"
          name="invoices-show-withdrawn"
          className="list-toggle"
          label={`Show withdrawn (${withdrawnCount})`}
          checked={showWithdrawn}
          onChange={(event) => setShowWithdrawn(event.target.checked)}
        />
      )}
      {data && (
        <RecordTable
          rows={showWithdrawn ? data : data.filter((i) => i.statusCode !== 'withdrawn')}
          rowKey={(invoiceRecord) => invoiceRecord.invoiceId}
          emptyMessage={withdrawnCount > 0 && !showWithdrawn ? 'No invoices besides withdrawn ones.' : 'No invoices yet.'}
          columns={[
            {
              header: 'Submitted',
              // A recall clears submittedAt; show the earlier submission.
              render: (i) =>
                i.submittedAt
                  ? formatDateTime(i.submittedAt)
                  : i.lastSubmittedAt
                    ? `${formatDateTime(i.lastSubmittedAt)}, then recalled`
                    : 'Not yet',
            },
            { header: 'Total', render: (i) => <span className="amount">{formatMoney(i.submittedTotal)}</span> },
            { header: 'Status', render: (i) => <StatusPill code={i.statusCode} label={i.statusDisplayName} /> },
            {
              header: 'Actions',
              render: (i) => (
                <span className="row-actions">
                  <RouterLink to={`/portal/invoices/${i.invoiceId}`}>
                    {i.statusCode === 'draft' ? 'Edit draft' : 'View invoice'}
                  </RouterLink>
                  {i.deletable && (
                    <DeleteInvoiceButton compact invoiceId={i.invoiceId} onDeleted={() => setListVersion((v) => v + 1)} />
                  )}
                </span>
              ),
            },
          ]}
        />
      )}

      <NewInvoiceForm
        caseId={caseId}
        billable={billable}
        entries={entries}
        onSaved={() => {
          setListVersion((version) => version + 1);
          onInvoiced();
        }}
      />
    </section>
  );
}

export default function PortalCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [timeEntryVersion, setTimeEntryVersion] = useState(0);
  // Only listMyCases() carries externalReference/clientDisplayName, needed for the heading label.
  const { data: myCases } = useApiResource(() => listMyCases().then((result) => result.cases), []);
  const { data: billable } = useApiResource(
    () => (caseId ? listBillableProfessionals(caseId).then((result) => result.professionals) : Promise.resolve([])),
    [caseId],
  );
  // Shared by both sections: invoicing changes what is unbilled.
  const { data: entries, error: entriesError } = useApiResource(
    () => (caseId ? listMyTimeEntries(caseId).then((result) => result.timeEntries) : Promise.resolve([])),
    [caseId, timeEntryVersion],
  );
  const refreshTime = () => setTimeEntryVersion((v) => v + 1);

  if (!caseId) {
    return null;
  }

  const myCase = myCases?.find((c) => c.caseId === caseId);
  const title = caseDisplayLabel(
    [myCase?.externalReference, myCase?.clientDisplayName],
    myCase ? { label: 'Case assigned', date: myCase.assignedAt } : undefined,
  );

  return (
    <div>
      <RouterLink className="back-link" to="/portal/cases">&larr; Back to your cases</RouterLink>
      <PageHeading eyebrow="Case" title={title} />
      {billable && billable.length > 0 && (
        <TimeEntrySection
          key={timeEntryVersion}
          caseId={caseId}
          billable={billable}
          entries={entries}
          error={entriesError}
          onLogged={refreshTime}
        />
      )}
      {billable && <InvoiceSection caseId={caseId} billable={billable} entries={entries} onInvoiced={refreshTime} />}
    </div>
  );
}
