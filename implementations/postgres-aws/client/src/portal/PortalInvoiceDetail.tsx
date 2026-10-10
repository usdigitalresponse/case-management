import { useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router';
import { Alert, Button } from '@trussworks/react-uswds';
import {
  ApiError,
  apiErrorMessage,
  getMyInvoice,
  listBillableProfessionals,
  transitionInvoice,
  updateDraftInvoice,
  type InvoiceTransition,
  type PortalInvoice,
} from '../api/client';
import { hasInvoiceItems, InvoiceLinesEditor, lineDraftsFrom, linesFromDrafts, type LineDraft } from '../components/InvoiceLinesEditor';
import { useApiResource } from '../hooks/useApiResource';
import { useAuth } from '../AuthContext';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { PageHeading } from '../components/PageHeading';
import { RecordTable } from '../components/RecordTable';
import { InvoiceExportLinks } from '../components/InvoiceExportLinks';
import { InvoiceSummary, invoiceReference, isSubmittedStatus } from '../components/InvoiceSummary';
import { LineDecision } from '../components/LineDecision';
import { ConfirmButton } from '../components/ConfirmButton';
import { PeriodFields } from '../components/PeriodFields';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatMoney } from '../formatMoney';
import { lineDate, lineDescription, lineHours, lineTimekeeper, lineType } from '../invoiceLineDisplay';

function DraftEditor({ data, onChanged }: { data: PortalInvoice; onChanged: () => void }) {
  const { invoice } = data;
  const navigate = useNavigate();
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(data.lines));
  const [period, setPeriod] = useState({ start: invoice.periodStart ?? '', end: invoice.periodEnd ?? '' });
  const { data: timekeepers } = useApiResource(
    () => listBillableProfessionals(invoice.caseId).then((result) => result.professionals),
    [invoice.caseId],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function run(action: 'save' | InvoiceTransition) {
    setBusy(true);
    setMessage(null);
    try {
      if (action === 'save' || action === 'submit') {
        await updateDraftInvoice(invoice.invoiceId, {
          periodStart: period.start || undefined,
          periodEnd: period.end || undefined,
          lines: linesFromDrafts(lines),
        });
      }
      if (action !== 'save') {
        await transitionInvoice(invoice.invoiceId, action);
      }
      if (action === 'save') {
        setMessage({ type: 'success', text: 'Draft saved.' });
      }
      onChanged();
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err, 'The draft could not be saved. Each item needs an amount above zero.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compact-card">
      <h2>Edit draft</h2>
      {message && <Alert type={message.type} slim>{message.text}</Alert>}
      <PeriodFields idPrefix="draft" start={period.start} end={period.end} onChange={setPeriod} />
      <InvoiceLinesEditor idPrefix="draft" lines={lines} onChange={setLines} timekeepers={timekeepers ?? []} />
      <div className="invoice-actions">
        <Button type="button" disabled={busy || !hasInvoiceItems(lines)} onClick={() => void run('submit')}>Submit invoice</Button>
        <Button type="button" outline disabled={busy || !hasInvoiceItems(lines)} onClick={() => void run('save')}>Save draft</Button>
        {!data.deletable ? (
          <ConfirmButton
            label="Withdraw draft"
            prompt="Withdraw this draft? It can't be submitted afterwards."
            confirmLabel="Yes, withdraw"
            disabled={busy}
            onConfirm={() => void run('withdraw')}
          />
        ) : (
          <DeleteInvoiceButton invoiceId={invoice.invoiceId} disabled={busy} onDeleted={() => navigate(`/portal/cases/${invoice.caseId}`)} />
        )}
      </div>
    </div>
  );
}

export default function PortalInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => getMyInvoice(invoiceId as string), [invoiceId, version]);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [recalling, setRecalling] = useState(false);
  const { user } = useAuth();

  async function recall() {
    setRecalling(true);
    setRecallError(null);
    try {
      await transitionInvoice(invoiceId as string, 'recall');
      setVersion((v) => v + 1);
    } catch (err) {
      setRecallError(apiErrorMessage(err, 'The invoice could not be recalled.'));
    } finally {
      setRecalling(false);
    }
  }

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Invoice not found.' : 'Failed to load invoice.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!data) {
    return <p role="status">Loading invoice…</p>;
  }

  const { invoice, lines } = data;
  // A professional viewing what a delegate submitted gets a read-only page.
  const isSubmitter = invoice.submittedByUserAccountId === user?.userAccountId;
  const isDraft = invoice.statusCode === 'draft';
  const submitted = isSubmittedStatus(invoice.statusCode);
  // Edited on import review until confirmed.
  const importUnconfirmed = Boolean(data.import && data.import.statusCode !== 'confirmed');
  const editing = isDraft && isSubmitter && !importUnconfirmed;
  // While editing, the editor offers Delete itself.
  const { deletable } = data;
  const recallable = isSubmitter && invoice.statusCode === 'submitted' && lines.every((line) => !line.decisionOutcomeCode);

  return (
    <div>
      <RouterLink className="back-link" to={`/portal/cases/${invoice.caseId}`}>&larr; Back to case</RouterLink>
      <PageHeading
        eyebrow={isDraft ? 'Draft invoice' : 'Invoice'}
        title={caseDisplayLabel([invoice.caseExternalReference, invoice.caseClientDisplayName], undefined)}
        description={invoiceReference(invoice.invoiceId)}
      />

      <InvoiceSummary invoice={invoice} lines={lines} />

      {(submitted || recallable || (deletable && !editing)) && (
        <div className="invoice-actions">
          {submitted && <InvoiceExportLinks scope="portal" invoiceId={invoice.invoiceId} />}
          {recallable && (
            <Button type="button" outline disabled={recalling} onClick={() => void recall()}>
              {recalling ? 'Recalling…' : 'Recall to draft'}
            </Button>
          )}
          {deletable && !editing && (
            <DeleteInvoiceButton invoiceId={invoice.invoiceId} onDeleted={() => navigate(`/portal/cases/${invoice.caseId}`)} />
          )}
        </div>
      )}
      {recallable && <p className="compact-hint">No one has reviewed this invoice yet, so you can recall it, change it and submit it again.</p>}
      {recallError && <Alert type="error" slim>{recallError}</Alert>}

      {isDraft && isSubmitter && importUnconfirmed && (
        <Alert type="info" slim>
          This draft was read from an uploaded file.{' '}
          <RouterLink to={`/portal/imports/${data.import?.invoiceImportId}`}>Review and confirm the import</RouterLink> before
          editing or submitting it.
        </Alert>
      )}

      {editing ? (
        <DraftEditor key={version} data={data} onChanged={() => setVersion((v) => v + 1)} />
      ) : (
        <div className="detail-section">
          <h2>Invoice items</h2>
          <RecordTable
            rows={lines}
            rowKey={(line) => line.invoiceLineId}
            emptyMessage="This invoice has no items."
            columns={[
              { header: 'Date', render: lineDate },
              { header: 'Type', render: lineType },
              { header: 'Description', render: lineDescription },
              { header: 'Timekeeper', render: lineTimekeeper },
              { header: 'Hours', render: lineHours },
              { header: 'Requested', render: (l) => <span className="amount">{formatMoney(l.amount)}</span> },
              ...(submitted ? [{ header: 'Decision', render: (l: (typeof lines)[number]) => <LineDecision line={l} /> }] : []),
            ]}
          />
        </div>
      )}
    </div>
  );
}
