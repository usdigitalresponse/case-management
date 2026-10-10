import { useState, type FormEvent } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Checkbox, Form, FormGroup, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  createInvoice,
  createTimeEntry,
  listBillableProfessionals,
  listMyCases,
  listMyInvoices,
  listMyTimeEntries,
  type BillableProfessional,
} from '../api/client';
import {
  emptyLine,
  hasInvoiceItems,
  InvoiceLinesEditor,
  linesFromDrafts,
  professionalLabel,
  type LineDraft,
} from '../components/InvoiceLinesEditor';
import { useApiResource } from '../hooks/useApiResource';
import { InvoiceImportForm } from '../components/InvoiceImportForm';
import { RecordTable } from '../components/RecordTable';
import { PageHeading } from '../components/PageHeading';
import { StatusPill } from '../components/StatusPill';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { PeriodFields } from '../components/PeriodFields';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDate, formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

function TimeEntrySection({ caseId, onLogged }: { caseId: string; onLogged: () => void }) {
  const { data, error } = useApiResource(() => listMyTimeEntries(caseId).then((result) => result.timeEntries), [caseId]);

  const [activityOn, setActivityOn] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await createTimeEntry({ caseId, activityOn, durationHours: Number(durationHours), description });
      setActivityOn('');
      setDurationHours('');
      setDescription('');
      onLogged();
    } catch {
      setSubmitError('The time could not be logged. Check the date, hours (0.25 to 24) and description.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Time</h2>
      {Boolean(error) && <Alert type="error">Failed to load time entries.</Alert>}
      {data && (
        <RecordTable
          rows={data}
          rowKey={(entry) => entry.timeEntryId}
          emptyMessage="No time logged yet."
          columns={[
            { header: 'Date', render: (e) => formatDate(e.activityOn) },
            { header: 'Hours', render: (e) => e.durationHours },
            { header: 'Description', render: (e) => e.description },
          ]}
        />
      )}

      <Form className="compact-form compact-card" onSubmit={(event) => void handleSubmit(event)}>
        <h3>Log time</h3>
        {submitError && <Alert type="error" slim>{submitError}</Alert>}
        <div className="inline-fields time-entry-fields">
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
          <Button type="submit" disabled={submitting || !activityOn || !durationHours || !description.trim()}>
            {submitting ? 'Logging…' : 'Log time'}
          </Button>
        </div>
      </Form>
    </section>
  );
}

function InvoiceSection({ caseId, billable }: { caseId: string; billable: BillableProfessional[] }) {
  const [listVersion, setListVersion] = useState(0);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const { data, error } = useApiResource(() => listMyInvoices(caseId).then((result) => result.invoices), [caseId, listVersion]);

  const [lines, setLines] = useState<LineDraft[]>([emptyLine]);
  const [period, setPeriod] = useState({ start: '', end: '' });
  // Defaults to the user's own profile; a delegate picks whom they bill for.
  const [billedProfessionalId, setBilledProfessionalId] = useState(
    () => (billable.find((p) => p.isSelf) ?? billable[0])?.professionalId ?? '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'draft' | 'submitted' | null>(null);
  const [mode, setMode] = useState<'enter' | 'import'>('enter');

  // Nothing to save until an item has an amount and someone is billed.
  const canSave = hasInvoiceItems(lines) && Boolean(billedProfessionalId);
  const withdrawnCount = data?.filter((i) => i.statusCode === 'withdrawn').length ?? 0;

  async function save(submit: boolean) {
    setSubmitError(null);
    setSaved(null);
    setSubmitting(true);
    try {
      await createInvoice({
        caseId,
        submit,
        professionalId: billedProfessionalId || undefined,
        periodStart: period.start || undefined,
        periodEnd: period.end || undefined,
        lines: linesFromDrafts(lines),
      });
      setLines([emptyLine]);
      setPeriod({ start: '', end: '' });
      setSaved(submit ? 'submitted' : 'draft');
      setListVersion((version) => version + 1);
    } catch (err) {
      setSubmitError(apiErrorMessage(err, 'The invoice could not be saved. Each item needs an amount above zero.'));
    } finally {
      setSubmitting(false);
    }
  }

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

      <div className="compact-card">
        <h3>New invoice</h3>
        {/* Applies to both a typed invoice and an imported file. */}
        {billable.length > 1 && (
          <div className="inline-fields billed-for-field">
            <FormGroup>
              <Label htmlFor="billed-professional">Billing for</Label>
              <Select
                id="billed-professional"
                name="billedProfessional"
                value={billedProfessionalId}
                onChange={(event) => setBilledProfessionalId(event.target.value)}
              >
                {billable.map((professional) => (
                  <option key={professional.professionalId} value={professional.professionalId}>
                    {professionalLabel(professional)}
                  </option>
                ))}
              </Select>
            </FormGroup>
          </div>
        )}
        <div className="choice-toggle" role="group" aria-label="How to add the invoice">
          <button type="button" aria-pressed={mode === 'enter'} onClick={() => setMode('enter')}>
            Enter items
          </button>
          <button type="button" aria-pressed={mode === 'import'} onClick={() => setMode('import')}>
            Import a file
          </button>
        </div>

        {mode === 'import' ? (
          <InvoiceImportForm caseId={caseId} professionalId={billedProfessionalId} />
        ) : (
          <Form
            className="compact-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void save(true);
            }}
          >
            {submitError && <Alert type="error" slim>{submitError}</Alert>}
            {saved === 'submitted' && <Alert type="success" slim>Invoice submitted.</Alert>}
            {saved === 'draft' && <Alert type="success" slim>Draft saved. Open it from the list above to edit or submit it.</Alert>}
            <PeriodFields idPrefix="new-invoice" start={period.start} end={period.end} onChange={setPeriod} />
            <InvoiceLinesEditor idPrefix="new-invoice" lines={lines} onChange={setLines} timekeepers={billable} />
            <div className="invoice-actions">
              <Button type="submit" disabled={submitting || !canSave}>
                {submitting ? 'Saving…' : 'Submit invoice'}
              </Button>
              <Button type="button" outline disabled={submitting || !canSave} onClick={() => void save(false)}>
                Save as draft
              </Button>
            </div>
          </Form>
        )}
      </div>
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
      <RouterLink className="back-link" to="/">&larr; Back to your cases</RouterLink>
      <PageHeading eyebrow="Case" title={title} />
      {/* Only professionals log their own time; a delegate only invoices. */}
      {billable?.some((p) => p.isSelf) && (
        <TimeEntrySection key={timeEntryVersion} caseId={caseId} onLogged={() => setTimeEntryVersion((v) => v + 1)} />
      )}
      {billable && <InvoiceSection caseId={caseId} billable={billable} />}
    </div>
  );
}
