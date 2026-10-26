import { useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router';
import { Alert, Button } from '@trussworks/react-uswds';
import {
  ApiError,
  apiErrorMessage,
  getMyInvoice,
  listBillableProfessionals,
  listMyTimeEntries,
  transitionInvoice,
  updateDraftInvoice,
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
import { formatDateTime, formatPeriod } from '../formatDateTime';
import { DecisionHistory, DecisionSummary } from '../components/LineReview';
import { ConfirmButton } from '../components/ConfirmButton';
import { PeriodFields } from '../components/PeriodFields';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatMoney } from '../formatMoney';
import { isMileage, lineDate, lineDescription, lineHours, lineRate, lineTimekeeper, lineType } from '../invoiceLineDisplay';
import { TravelLog } from '../components/TravelLog';

function DraftEditor({ data, onChanged }: { data: PortalInvoice; onChanged: () => void }) {
  const { invoice } = data;
  const navigate = useNavigate();
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(data.lines));
  const [period, setPeriod] = useState({ start: invoice.periodStart ?? '', end: invoice.periodEnd ?? '' });
  const { data: timekeepers } = useApiResource(
    () => listBillableProfessionals(invoice.caseId).then((result) => result.professionals),
    [invoice.caseId],
  );
  // Unbilled time can be ticked on; time already on this draft shows ticked.
  const { data: caseTime } = useApiResource(
    () => listMyTimeEntries(invoice.caseId).then((result) => result.timeEntries),
    [invoice.caseId],
  );
  const billableIds = new Set((timekeepers ?? []).map((p) => p.professionalId));
  const pickable = (caseTime ?? []).filter(
    (entry) =>
      billableIds.has(entry.professionalId) && (!entry.billing || entry.billing.invoiceId === invoice.invoiceId),
  );
  const billingRules = usePortalBillingRules();
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
      setMessage({
        type: 'error',
        text: apiErrorMessage(err, 'The draft could not be saved. Time items need a date and hours, mileage a date and miles, and other items an amount above zero.'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="compact-card">
      <h2>Edit draft</h2>
      {message && <Alert type={message.type} slim>{message.text}</Alert>}
      <RulesInForce rules={billingRules.rules} />
      {/* As last saved; saving shows the effect of edits. */}
      <RuleFindings findings={data.ruleFindings} />
      <PeriodFields idPrefix="draft" start={period.start} end={period.end} onChange={setPeriod} />
      <UnbilledTimePicker idPrefix="draft" entries={pickable} lines={lines} onChange={setLines} timekeepers={timekeepers ?? []} />
      <InvoiceLinesEditor
        idPrefix="draft"
        lines={lines}
        onChange={setLines}
        timekeepers={timekeepers ?? []}
        billedProfessionalId={invoice.professionalId}
        recordedTime={pickable}
        billingCodes={billingRules.codes}
        mileageRates={billingRules.mileageRates}
      />
      <div className="invoice-actions">
        <Button type="button" disabled={busy || !hasInvoiceItems(lines)} onClick={() => void run('submit')}>Submit invoice</Button>
        <Button type="button" outline disabled={busy || !hasInvoiceItems(lines)} onClick={() => void run('save')}>Save draft</Button>
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
            <DeleteInvoiceButton invoiceId={invoice.invoiceId} disabled={busy} onDeleted={() => navigate(`/portal/cases/${invoice.caseId}`)} />
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
  const decidedCount = lines.filter((line) => line.decision).length;
  const delegated = invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName;

  return (
    <div>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        {fromBulk ? (
          <RouterLink to="/portal/imports">Imports</RouterLink>
        ) : (
          <RouterLink to="/portal/invoices">Your invoices</RouterLink>
        )}
        <span aria-hidden="true">›</span>
        <RouterLink to={`/portal/cases/${invoice.caseId}`}>{invoice.caseClientDisplayName ?? 'Case'}</RouterLink>
        <span aria-hidden="true">›</span>
        <span>{invoiceReference(invoice.invoiceId)}</span>
      </nav>
      <div className="page-title-row">
        <div>
          <h1>
            {invoice.caseClientDisplayName ?? caseDisplayLabel([invoice.caseExternalReference], undefined)}{' '}
            <StatusPill code={invoice.statusCode} label={isDraft ? 'Draft' : invoice.statusDisplayName} />
          </h1>
          <p className="title-meta">
            <strong>Case {data.caseNumber ?? invoice.caseExternalReference ?? '—'}</strong>
            <span>
              {invoice.professionalDisplayName ?? 'Unknown'}
              {delegated ? `, sent by ${invoice.submittedByDisplayName}` : ''}
            </span>
          </p>
        </div>
        {(submitted || recallable || (deletable && !editing)) && (
          <div className="title-actions">
            {recallable && (
              <button type="button" className="btn btn--outline" disabled={recalling} onClick={() => void recall()}>
                {recalling ? 'Recalling…' : 'Recall to draft'}
              </button>
            )}
            {submitted && <InvoiceExportLinks scope="portal" invoiceId={invoice.invoiceId} />}
            {deletable && !editing && (
              <DeleteInvoiceButton invoiceId={invoice.invoiceId} onDeleted={() => navigate(`/portal/cases/${invoice.caseId}`)} />
            )}
          </div>
        )}
      </div>

      <dl className="facts-strip">
        <div>
          <dt>Submitted</dt>
          <dd><strong>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : 'Not yet'}</strong></dd>
        </div>
        <div>
          <dt>Billing period</dt>
          <dd>{formatPeriod(invoice.periodStart, invoice.periodEnd)}</dd>
        </div>
        <div>
          <dt>{submitted ? 'Requested' : 'Total'}</dt>
          <dd><strong>{formatMoney(invoice.submittedTotal)}</strong></dd>
        </div>
        {submitted && (
          <>
            <div>
              <dt>Approved</dt>
              <dd>{data.approvedTotal === null ? 'Not reviewed yet' : formatMoney(data.approvedTotal)}</dd>
            </div>
            <div>
              <dt>Lines decided</dt>
              <dd>
                {decidedCount} of {lines.length}
                <span className="progress" aria-hidden="true">
                  <span style={{ width: `${lines.length ? (decidedCount / lines.length) * 100 : 0}%` }} />
                </span>
              </dd>
            </div>
          </>
        )}
      </dl>
      {submitted && <RuleFindings findings={data.ruleFindings} submitted />}
      {recallable && (
        <div className="notice notice--info">No one has reviewed this invoice yet, so you can recall it, change it and submit it again.</div>
      )}
      {recallError && <div className="notice notice--danger" role="alert">{recallError}</div>}

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
          {submitted && data.approvedTotal !== null && (
            <p className="compact-hint">
              Approved {formatMoney(data.approvedTotal)} of {formatMoney(invoice.submittedTotal)}. Each line shows why.
            </p>
          )}
          {lines.length === 0 ? (
            <p className="empty-note">This invoice has no items.</p>
          ) : (
            <div className="data-card">
              <table className="usa-table review-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">What was done</th>
                    <th scope="col" className="amount">{lines.some(isMileage) ? 'Hours / miles' : 'Hours'}</th>
                    <th scope="col" className="amount">Rate</th>
                    <th scope="col" className="amount">Requested</th>
                    {submitted && <th scope="col">Decision</th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.invoiceLineId} className={line.decision?.outcomeCode === 'rejected' ? 'is-rejected' : undefined}>
                      <td>{lineDate(line)}</td>
                      <td>
                        {lineDescription(line)}
                        <span className="cell-note">{lineType(line)} · {lineTimekeeper(line)}</span>
                      </td>
                      <td className="amount">{lineHours(line)}</td>
                      <td className="amount">{lineRate(line)}</td>
                      <td className="amount"><strong>{formatMoney(line.amount)}</strong></td>
                      {submitted && (
                        <td className="decision-cell">
                          {line.decision ? (
                            <>
                              <DecisionSummary decision={line.decision} requested={line.amount} />
                              <DecisionHistory line={line} />
                            </>
                          ) : (
                            <span className="muted">Not reviewed yet</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {!editing && <TravelLog lines={lines} findings={data.ruleFindings} />}
    </div>
  );
}
