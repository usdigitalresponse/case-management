import { useState, type FormEvent } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import { Alert, Button, Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import {
  createInvoice,
  createTimeEntry,
  listMyInvoices,
  listMyTimeEntries,
  type CreateInvoiceLineInput,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { RecordTable } from '../components/RecordTable';

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
      setSubmitError('Failed to log time. Check the fields above and try again.');
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
            { header: 'Date', render: (e) => e.activityOn },
            { header: 'Hours', render: (e) => e.durationHours },
            { header: 'Description', render: (e) => e.description },
          ]}
        />
      )}

      <Form onSubmit={(event) => void handleSubmit(event)}>
        {submitError && <Alert type="error">{submitError}</Alert>}
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
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Logging…' : 'Log time'}
        </Button>
      </Form>
    </section>
  );
}

function InvoiceSection({ caseId }: { caseId: string }) {
  const { data, error } = useApiResource(() => listMyInvoices(caseId).then((result) => result.invoices), [caseId]);

  // Held as raw strings, not numbers: an input bound to `line.amount || ''`
  // would render blank whenever the amount is exactly 0, since `0 || ''`
  // evaluates to `''` — the text the user typed is the source of truth
  // until submit, when it's parsed into CreateInvoiceLineInput.
  const [amountInputs, setAmountInputs] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function updateLineAmount(index: number, value: string) {
    setAmountInputs((previous) => previous.map((amount, i) => (i === index ? value : amount)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const lines: CreateInvoiceLineInput[] = amountInputs
        .map((value) => Number(value))
        .filter((amount) => amount > 0)
        .map((amount) => ({ amount }));
      await createInvoice({ caseId, lines });
      setAmountInputs(['']);
      setSubmitted(true);
    } catch {
      setSubmitError('Failed to submit the invoice. Check the line amounts and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>Invoices</h2>
      {Boolean(error) && <Alert type="error">Failed to load invoices.</Alert>}
      {data && (
        <RecordTable
          rows={data}
          rowKey={(invoiceRecord) => invoiceRecord.invoiceId}
          emptyMessage="No invoices submitted yet."
          columns={[
            { header: 'Submitted', render: (i) => i.submittedAt ?? '—' },
            { header: 'Total', render: (i) => `$${i.submittedTotal}` },
            { header: 'Status', render: (i) => i.statusId },
          ]}
        />
      )}

      <Form onSubmit={(event) => void handleSubmit(event)}>
        {submitError && <Alert type="error">{submitError}</Alert>}
        {submitted && <Alert type="success">Invoice submitted.</Alert>}
        {amountInputs.map((amount, index) => (
          <FormGroup key={index}>
            <Label htmlFor={`line-amount-${index}`}>Line {index + 1} amount ($)</Label>
            <TextInput
              id={`line-amount-${index}`}
              name={`line-amount-${index}`}
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => updateLineAmount(index, event.target.value)}
            />
          </FormGroup>
        ))}
        <Button type="button" unstyled onClick={() => setAmountInputs((previous) => [...previous, ''])}>
          + Add another line
        </Button>
        <br />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit invoice'}
        </Button>
      </Form>
    </section>
  );
}

export default function PortalCaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const [timeEntryVersion, setTimeEntryVersion] = useState(0);

  if (!caseId) {
    return null;
  }

  return (
    <div>
      <RouterLink to="/">&larr; Back to your cases</RouterLink>
      <h1>Case {caseId}</h1>
      <TimeEntrySection key={timeEntryVersion} caseId={caseId} onLogged={() => setTimeEntryVersion((v) => v + 1)} />
      <InvoiceSection caseId={caseId} />
    </div>
  );
}
