import { useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router';
import {
  apiErrorMessage,
  getMyInvoice,
  listBillableProfessionals,
  listMyTimeEntries,
  transitionInvoice,
  updateDraftInvoice,
  type InvoiceReceipt,
  type InvoiceTransition,
  type PortalInvoice,
} from '../api/client';
import { hasInvoiceItems, InvoiceLinesEditor, lineDraftsFrom, linesFromDrafts, type LineDraft } from '../components/InvoiceLinesEditor';
import { useApiResource } from '../hooks/useApiResource';
import { UnbilledTimePicker } from '../components/UnbilledTimePicker';
import { RuleFindings, RulesInForce, usePortalBillingRules } from '../components/BillingRules';
import { useAuth } from '../AuthContext';
import { DeleteInvoiceButton } from '../components/DeleteInvoiceButton';
import { InvoiceExportLinks } from '../components/InvoiceExportLinks';
import { invoiceReference, isSubmittedStatus } from '../components/InvoiceSummary';
import { StatusPill } from '../components/StatusPill';
import { RecordedDecision } from '../components/LineReview';
import { ConfirmButton } from '../components/ConfirmButton';
import { PeriodFields } from '../components/PeriodFields';
import { PageHeader } from '../components/PageHeader';
import { Fact, FactsStrip, Progress } from '../components/FactsStrip';
import { LoadState } from '../components/LoadState';
import { InvoiceLinesTable, lineRowClass } from '../components/InvoiceLinesTable';
import { TravelLog } from '../components/TravelLog';
import { Notice, type SaveMessage } from '../components/Notice';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatDate, formatDateTime, formatPeriod } from '../formatDateTime';
import { hasReceipt, ReceivedFields } from './ReceivedFields';
import { INTAKE_PATH, useShell } from './useShell';
import { formatMoney } from '../formatMoney';
import { submittedByLabel } from '../reviewTotals';

function DraftEditor({ data, onChanged, onDeleted }: { data: PortalInvoice; onChanged: () => void; onDeleted: () => void }) {
  const { invoice } = data;
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(data.lines));
  const [period, setPeriod] = useState({ start: invoice.periodStart ?? '', end: invoice.periodEnd ?? '' });
  const { data: timekeepers } = useApiResource(
    () => listBillableProfessionals(invoice.caseId).then((result) => result.professionals),
    [invoice.caseId],
  );
  // Unbilled time can be ticked on; time already on this draft shows ticked.
  // Recorded time belongs to a case, so an invoice in intake has none.
  const { data: caseTime } = useApiResource(
    () => (invoice.caseId ? listMyTimeEntries(invoice.caseId).then((result) => result.timeEntries) : Promise.resolve([])),
    [invoice.caseId],
  );
  const noCase = invoice.caseId === null;
  const billableIds = new Set((timekeepers ?? []).map((p) => p.professionalId));
  const pickable = (caseTime ?? []).filter(
    (entry) =>
      billableIds.has(entry.professionalId) && (!entry.billing || entry.billing.invoiceId === invoice.invoiceId),
  );
  const billingRules = usePortalBillingRules();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const { staff } = useShell();
  const [receipt, setReceipt] = useState<InvoiceReceipt>({ receivedOn: invoice.receivedOn ?? undefined });
  const needsReceipt = staff && !hasReceipt(receipt);

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
        await transitionInvoice(
          invoice.invoiceId,
          action,
          action === 'submit' && staff ? { ...receipt, withoutCase: noCase || undefined } : undefined,
        );
      }
      if (action === 'save') {
        setMessage({ tone: 'success', text: 'Draft saved.' });
      }
      onChanged();
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: apiErrorMessage(err, 'The draft could not be saved. Time items need a date and hours, mileage a date and miles, and other items an amount above zero.'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compact-card">
      <h2>Edit draft</h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {noCase && (
        <Notice tone="warning" heading="This invoice isn't linked to a case.">
          {invoice.professionalId === null ? (
            <>
              Match it to a case on <RouterLink to={INTAKE_PATH}>Intake</RouterLink>, where you also choose who it's from.
            </>
          ) : (
            <>
              Match it to a case on <RouterLink to={INTAKE_PATH}>Intake</RouterLink>. You can still send it to review without
              one, but this system won't check the case, the provider's assignment or any pre-authorization, and its
              documents will say so.
            </>
          )}
        </Notice>
      )}
      <RulesInForce rules={billingRules.rules} />
      {/* As last saved; saving shows the effect of edits. */}
      <RuleFindings findings={data.ruleFindings} />
      {staff && (
        <ReceivedFields idPrefix="draft" value={receipt} onChange={setReceipt} receivedViaDisplayName={invoice.receivedViaDisplayName} />
      )}
      <PeriodFields idPrefix="draft" start={period.start} end={period.end} onChange={setPeriod} />
      {!noCase && (
        <UnbilledTimePicker idPrefix="draft" entries={pickable} lines={lines} onChange={setLines} timekeepers={timekeepers ?? []} />
      )}
      <InvoiceLinesEditor
        idPrefix="draft"
        lines={lines}
        onChange={setLines}
        timekeepers={timekeepers ?? []}
        billedProfessionalId={invoice.professionalId ?? undefined}
        recordedTime={pickable}
        billingCodes={billingRules.codes}
        mileageRates={billingRules.mileageRates}
      />
      <div className="invoice-actions">
        {/* Who it's from is chosen when it's matched, so it can't go to review yet. */}
        {invoice.professionalId !== null && (
          <button
            type="button"
            className={`btn ${noCase ? 'btn--outline' : 'btn--primary'}`}
            disabled={busy || !hasInvoiceItems(lines) || needsReceipt}
            onClick={() => void run('submit')}
          >
            {noCase ? 'Review without a case' : 'Submit invoice'}
          </button>
        )}
        <button type="button" className="btn btn--outline" disabled={busy || !hasInvoiceItems(lines)} onClick={() => void run('save')}>
          Save draft
        </button>
        <span className="actions-end">
          {!data.deletable ? (
            <ConfirmButton
              label="Withdraw draft"
              prompt="Withdraw this draft? It can't be submitted afterwards."
              confirmLabel="Yes, withdraw"
              disabled={busy}
              onConfirm={() => void run('withdraw')}
            />
          ) : (
            <DeleteInvoiceButton invoiceId={invoice.invoiceId} disabled={busy} onDeleted={onDeleted} />
          )}
        </span>
      </div>
    </div>
  );
}

export default function PortalInvoiceDetail() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromBulk = searchParams.get('from') === 'bulk';
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => getMyInvoice(invoiceId as string), [invoiceId, version]);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [recalling, setRecalling] = useState(false);
  const { user } = useAuth();
  const shell = useShell();

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

  if (error || !data) {
    return <LoadState error={error} what="invoice" />;
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
  const decidedCount = lines.filter((line) => line.decision).length;
  const toInvoices = () => navigate(shell.invoicesPath);

  return (
    <div>
      <PageHeader
        crumbs={[
          fromBulk
            ? { label: 'Imports', to: '/portal/imports' }
            : { label: shell.invoicesLabel, to: shell.invoicesPath },
          invoice.caseId
            ? { label: invoice.caseClientDisplayName ?? 'Case', to: shell.casePath(invoice.caseId) }
            : { label: 'No case yet' },
          { label: invoiceReference(invoice.invoiceId) },
        ]}
        title={
          invoice.caseId
            ? (invoice.caseClientDisplayName ?? caseDisplayLabel([invoice.caseExternalReference], undefined))
            : `Invoice from ${invoice.professionalDisplayName ?? 'an unknown provider'}`
        }
        status={<StatusPill code={invoice.statusCode} label={isDraft ? 'Draft' : invoice.statusDisplayName} />}
        meta={
          <>
            <strong>Case {data.caseNumber ?? invoice.caseExternalReference ?? '—'}</strong>
            <span>{submittedByLabel(invoice)}</span>
            {invoice.receivedOn && (
              <span>
                Received {invoice.receivedViaDisplayName ? `by ${invoice.receivedViaDisplayName.toLowerCase()} ` : ''}on{' '}
                {formatDate(invoice.receivedOn)}
              </span>
            )}
          </>
        }
        actions={
          (submitted || recallable || (deletable && !editing)) && (
            <>
              {shell.staff && submitted && (
                <RouterLink className="btn btn--primary" to={`/billing/${invoice.invoiceId}`}>Open in review</RouterLink>
              )}
              {recallable && (
                <button type="button" className="btn btn--outline" disabled={recalling} onClick={() => void recall()}>
                  {recalling ? 'Recalling…' : 'Recall to draft'}
                </button>
              )}
              {submitted && <InvoiceExportLinks scope="portal" invoiceId={invoice.invoiceId} />}
              {deletable && !editing && <DeleteInvoiceButton invoiceId={invoice.invoiceId} onDeleted={toInvoices} />}
            </>
          )
        }
      />

      <FactsStrip>
        <Fact label="Submitted">
          <strong>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : 'Not yet'}</strong>
        </Fact>
        <Fact label="Billing period">{formatPeriod(invoice.periodStart, invoice.periodEnd)}</Fact>
        <Fact label={submitted ? 'Requested' : 'Total'}>
          <strong>{formatMoney(invoice.submittedTotal)}</strong>
        </Fact>
        {submitted && (
          <>
            <Fact label="Approved">{data.approvedTotal === null ? 'Not reviewed yet' : formatMoney(data.approvedTotal)}</Fact>
            <Fact label="Lines decided">
              <Progress done={decidedCount} total={lines.length} />
            </Fact>
          </>
        )}
      </FactsStrip>
      {submitted && <RuleFindings findings={data.ruleFindings} submitted />}
      {recallable && (
        <Notice tone="info">No one has reviewed this invoice yet, so you can recall it, change it and submit it again.</Notice>
      )}
      {recallError && <Notice tone="danger">{recallError}</Notice>}

      {isDraft && isSubmitter && importUnconfirmed && (
        <Notice tone="info">
          This draft was read from an uploaded file.{' '}
          <RouterLink to={`/portal/imports/${data.import?.invoiceImportId}`}>Review and confirm the import</RouterLink> before
          editing or submitting it.
        </Notice>
      )}

      {editing ? (
        <DraftEditor key={version} data={data} onChanged={() => setVersion((v) => v + 1)} onDeleted={toInvoices} />
      ) : (
        <div className="detail-section">
          <h2>Invoice items</h2>
          {submitted && data.approvedTotal !== null && (
            <p className="compact-hint">
              Approved {formatMoney(data.approvedTotal)} of {formatMoney(invoice.submittedTotal)}. Each line shows why.
            </p>
          )}
          <InvoiceLinesTable
            lines={lines}
            rowClassName={(line) => lineRowClass(line.decision?.outcomeCode, false)}
            decision={submitted ? (line) => <RecordedDecision line={line} decision={line.decision} /> : undefined}
          />
        </div>
      )}
      {!editing && <TravelLog lines={lines} findings={data.ruleFindings} />}
    </div>
  );
}
