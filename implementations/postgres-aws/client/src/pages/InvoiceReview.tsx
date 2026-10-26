import { Fragment, useEffect, useRef, useState } from 'react';
import { useParams, Link as RouterLink } from 'react-router';
import { Alert } from '@trussworks/react-uswds';
import {
  ApiError,
  apiErrorMessage,
  decideInvoiceLine,
  finishReview,
  getInvoiceForReview,
  listDecisionReasons,
  reopenReview,
  repriceInvoice,
  signOffInvoice,
  undoInvoiceLineDecision,
  type DecisionReason,
  type InvoiceReview as InvoiceReviewData,
  type InvoiceReviewLine,
  type LineDecision,
  type LineDecisionInput,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { InvoiceExportLinks } from '../components/InvoiceExportLinks';
import { RuleFindings } from '../components/BillingRules';
import { TravelLog } from '../components/TravelLog';
import { StatusPill } from '../components/StatusPill';
import { DecisionHistory, DecisionPanel, DecisionSummary } from '../components/LineReview';
import { ReviewerPicker, SignOffApprovers } from '../components/ReviewRouting';
import { isMileage, lineDate, lineDescription, lineHours, lineRate, lineTimekeeper, lineType } from '../invoiceLineDisplay';
import { formatDateTime, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';

type PanelMode = 'approved_in_part' | 'rejected' | 'note';

interface Toast {
  message: string;
  undo?: () => Promise<unknown>;
}

const cents = (value: string | null | undefined) => Math.round(Number(value ?? 0) * 100);

// Rate check: lines billed at a rate other than the configured one, shown
// once above the table rather than on every line.
function rateCheck(lines: InvoiceReviewLine[]) {
  const differing = lines.filter(
    (line) => line.configuredRate !== null && line.billedRate !== null && Number(line.billedRate) !== Number(line.configuredRate),
  );
  if (differing.length === 0) {
    return null;
  }
  const above = differing.filter((line) => Number(line.billedRate) > Number(line.configuredRate));
  const sample = differing[0]!;
  return { differing, above, billed: sample.billedRate as string, configured: sample.configuredRate as string };
}

export default function InvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { user } = useAuth();
  const permissions = user?.reviewPermissions;
  const { data: loaded, error } = useApiResource(() => getInvoiceForReview(invoiceId as string), [invoiceId]);
  const { data: reasonData } = useApiResource(() => listDecisionReasons(), []);
  const reasons: DecisionReason[] = reasonData?.reasons ?? [];
  // Refreshed in place after each action, so open panels aren't unmounted.
  const [refreshed, setRefreshed] = useState<InvoiceReviewData | null>(null);
  const latestRequest = useRef(0);
  const data = refreshed?.invoice.invoiceId === invoiceId ? refreshed : loaded;

  const [panel, setPanel] = useState<{ lineId: string; mode: PanelMode } | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [comment, setComment] = useState('');
  const [sendingBack, setSendingBack] = useState(false);

  useEffect(() => {
    latestRequest.current += 1;
    setRefreshed(null);
    setPanel(null);
    setToast(null);
  }, [invoiceId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function refresh() {
    const request = ++latestRequest.current;
    return getInvoiceForReview(invoiceId as string).then((result) => {
      if (request === latestRequest.current) setRefreshed(result);
    });
  }

  async function act(action: () => Promise<unknown>, next?: Toast) {
    setSaving(true);
    setActionError(null);
    try {
      await action();
      setPanel(null);
      setChoosing(null);
      setToast(next ?? null);
      await refresh();
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err, 'That did not save. Try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Invoice not found.' : 'Failed to load invoice.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!data) {
    return <p role="status">Loading invoice…</p>;
  }

  const { invoice, lines, assignments } = data;
  const userId = user?.userAccountId ?? '';
  const status = invoice.statusCode;
  const inReview = status === 'submitted' || status === 'under_review';
  const reviewer = assignments?.reviewer ?? null;
  const isReviewer = reviewer?.userAccountId === userId;
  // Deciding a line on an unassigned invoice takes it.
  const canDecide = inReview && Boolean(permissions?.reviewLines) && (!reviewer || isReviewer);
  const lineNumber = new Map(lines.map((line, index) => [line.invoiceLineId, index + 1]));

  // While reviewing, the working decisions; afterwards, the recorded ones.
  const current = (line: InvoiceReviewLine): LineDecision | null => (inReview ? line.working : line.decision);
  const decided = lines.filter((line) => current(line)).length;
  const approvedCents = lines.reduce((sum, line) => sum + cents(current(line)?.approvedAmount), 0);
  const requestedCents = cents(invoice.submittedTotal);
  const counts = {
    approved: lines.filter((line) => current(line)?.outcomeCode === 'approved').length,
    part: lines.filter((line) => current(line)?.outcomeCode === 'approved_in_part').length,
    rejected: lines.filter((line) => current(line)?.outcomeCode === 'rejected').length,
  };
  const check = rateCheck(lines);
  const otherFindings = (data.ruleFindings ?? []).filter((finding) => finding.rule !== 'mileage_distance');
  const mileageFindings = (data.ruleFindings ?? []).filter((finding) => finding.rule === 'mileage_distance');

  const approvers = assignments?.signOff ?? [];
  const nextApprover = data.nextSignOff;
  const canSignOff = Boolean(permissions?.signOff) && nextApprover?.userAccountId === userId;
  const canReopen = status === 'awaiting_sign_off' && isReviewer && !data.signOffStarted;
  const sentBack = status === 'under_review' ? data.signOffs.filter((s) => s.outcomeCode === 'changes_requested').at(-1) : undefined;

  async function decide(line: InvoiceReviewLine, input: LineDecisionInput, label: string) {
    const previous = line.working;
    await act(() => decideInvoiceLine(invoice.invoiceId, line.invoiceLineId, input), {
      message: `Line ${lineNumber.get(line.invoiceLineId)} ${label}.`,
      undo: () =>
        previous
          ? decideInvoiceLine(invoice.invoiceId, line.invoiceLineId, {
              outcome: previous.outcomeCode,
              approvedAmount: previous.approvedQuantity ? undefined : Number(previous.approvedAmount ?? 0) || undefined,
              approvedQuantity: previous.approvedQuantity ? Number(previous.approvedQuantity) : undefined,
              approvedRate: previous.approvedRate ? Number(previous.approvedRate) : undefined,
              reasonCode: previous.reasonCode ?? undefined,
              note: previous.note ?? undefined,
            })
          : undoInvoiceLineDecision(invoice.invoiceId, line.invoiceLineId),
    });
  }

  function decisionCell(line: InvoiceReviewLine) {
    const decision = current(line);
    const showButtons = canDecide && (!decision || choosing === line.invoiceLineId);
    if (showButtons) {
      const openPanel = panel?.lineId === line.invoiceLineId ? panel.mode : null;
      return (
        <div className="decision-buttons">
          <button type="button" className="btn btn--outline" disabled={saving} onClick={() => void decide(line, { outcome: 'approved' }, 'approved')}>
            Approve
          </button>
          <button
            type="button"
            className={`btn ${openPanel === 'approved_in_part' ? 'btn--primary' : 'btn--outline'}`}
            aria-expanded={openPanel === 'approved_in_part'}
            onClick={() => setPanel(openPanel === 'approved_in_part' ? null : { lineId: line.invoiceLineId, mode: 'approved_in_part' })}
          >
            Approve part
          </button>
          <button
            type="button"
            className={`btn ${openPanel === 'rejected' ? 'btn--danger-solid' : 'btn--danger'}`}
            aria-expanded={openPanel === 'rejected'}
            onClick={() => setPanel(openPanel === 'rejected' ? null : { lineId: line.invoiceLineId, mode: 'rejected' })}
          >
            Reject
          </button>
          {openPanel && <span className="cell-note decision-hint">Give a reason below</span>}
          {decision && (
            <button type="button" className="link-button" onClick={() => setChoosing(null)}>Keep {decision.outcomeDisplayName.toLowerCase()}</button>
          )}
        </div>
      );
    }
    if (!decision) {
      return <span className="muted">{inReview ? 'Not decided' : 'Not reviewed'}</span>;
    }
    return (
      <>
        <DecisionSummary decision={decision} requested={line.amount} />
        {canDecide && (
          <div className="link-row">
            {decision.outcomeCode !== 'rejected' && (
              <button
                type="button"
                className="link-button"
                onClick={() => setPanel({ lineId: line.invoiceLineId, mode: decision.outcomeCode === 'approved' ? 'note' : 'approved_in_part' })}
              >
                {decision.note ? 'Edit note' : 'Add a note'}
              </button>
            )}
            {decision.outcomeCode === 'rejected' && (
              <button
                type="button"
                className="link-button"
                onClick={() => void act(() => undoInvoiceLineDecision(invoice.invoiceId, line.invoiceLineId), { message: 'Rejection undone. The line is undecided.' })}
              >
                Undo rejection
              </button>
            )}
            <button type="button" className="link-button" onClick={() => setChoosing(line.invoiceLineId)}>Change</button>
          </div>
        )}
        <DecisionHistory line={line} />
      </>
    );
  }

  return (
    <div className="invoice-review">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <RouterLink to="/">Invoices</RouterLink>
        <span aria-hidden="true">›</span>
        <RouterLink to={`/cases/${invoice.caseId}`}>{invoice.caseClientDisplayName ?? 'Case'}</RouterLink>
        <span aria-hidden="true">›</span>
        <span>Invoice {invoice.invoiceId.slice(0, 8)}</span>
      </nav>

      <div className="page-title-row">
        <div>
          <h1>
            {invoice.caseClientDisplayName ?? 'Unknown client'}{' '}
            <StatusPill
              code={inReview && decided === lines.length && lines.length > 0 ? 'every_line_decided' : status}
              label={inReview && decided === lines.length && lines.length > 0 ? 'Every line decided' : invoice.statusDisplayName}
            />
          </h1>
          <p className="title-meta">
            <strong>Case {data.caseNumber ?? '—'}</strong>
            <span>
              {invoice.professionalKindDisplayName ?? 'Professional'} invoice from {invoice.professionalDisplayName ?? 'unknown'}
              {invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName
                ? `, sent by ${invoice.submittedByDisplayName}`
                : ''}
            </span>
            <button type="button" className="link-button" disabled title="Not connected yet">
              Open the case in your {EXTERNAL_SYSTEM_NAME} ↗
            </button>
          </p>
        </div>
        <div className="title-actions">
          <ReviewerPicker
            invoiceId={invoice.invoiceId}
            reviewer={reviewer}
            currentUserId={userId}
            canChange={inReview && Boolean(permissions?.reassign)}
            onChanged={(message) => {
              setToast({ message });
              void refresh();
            }}
          />
          <InvoiceExportLinks scope="staff" invoiceId={invoice.invoiceId} />
        </div>
      </div>

      <dl className="facts-strip">
        <div>
          <dt>Case number</dt>
          <dd>
            <strong>{data.caseNumber ?? '—'}</strong>
            {data.otherCaseNumbers.length > 0 && <span className="cell-note">{data.otherCaseNumbers.join(', ')}</span>}
          </dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd><strong>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : '—'}</strong></dd>
        </div>
        <div>
          <dt>Billing period</dt>
          <dd>{formatPeriod(invoice.periodStart, invoice.periodEnd)}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd><strong>{formatMoney(invoice.submittedTotal)}</strong></dd>
        </div>
        <div>
          <dt>Approved so far</dt>
          <dd>
            {formatMoney(approvedCents / 100)}
            {decided > 0 && requestedCents > approvedCents && counts.part + counts.rejected > 0 && (
              <span className="cell-note">
                {formatMoney(
                  (lines.filter((line) => current(line)).reduce((sum, line) => sum + cents(line.amount), 0) - approvedCents) / 100,
                )}{' '}
                cut
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Pre-authorized</dt>
          <dd>
            {data.preauthorization ? (
              <>
                <strong>{formatMoney(data.preauthorization.ceiling)}</strong>
                <span className="cell-note">
                  {formatMoney(data.preauthorization.approvedSoFar)} approved, {formatMoney(data.preauthorization.waiting)} waiting
                </span>
              </>
            ) : (
              'None'
            )}
          </dd>
        </div>
        <div>
          <dt>Lines decided</dt>
          <dd>
            {decided} of {lines.length}
            <span className="progress" aria-hidden="true">
              <span style={{ width: `${lines.length ? (decided / lines.length) * 100 : 0}%` }} />
            </span>
          </dd>
        </div>
      </dl>

      {inReview && (
        <SignOffApprovers
          invoiceId={invoice.invoiceId}
          approvers={approvers}
          canChange={isReviewer || Boolean(permissions?.changeSettings) || (!reviewer && Boolean(permissions?.reviewLines))}
          onChanged={(message) => {
            setToast({ message });
            void refresh();
          }}
        />
      )}

      {sentBack && (
        <div className="notice notice--info" role="status">
          <strong>Sent back by {sentBack.displayName ?? 'the approver'} on {formatDateTime(sentBack.decidedAt)}.</strong>
          {sentBack.comment && <span>“{sentBack.comment}” Only staff see this comment.</span>}
        </div>
      )}

      {check && (
        <div className="notice notice--warning">
          <span>
            Rate check: {check.differing.length === 1 ? 'one line is' : `${check.differing.length} lines are`} billed at{' '}
            {formatMoney(check.billed)} an hour; the configured rate is {formatMoney(check.configured)} an hour.
            {check.above.length > 0 && canDecide && ' Re-pricing approves those lines in part at the configured rate.'}
          </span>
          {check.above.length > 0 && canDecide && (
            <button
              type="button"
              className="btn btn--outline"
              disabled={saving}
              onClick={() =>
                void act(async () => {
                  const { repriced } = await repriceInvoice(invoice.invoiceId);
                  setToast({ message: `${repriced} ${repriced === 1 ? 'line' : 'lines'} re-priced at ${formatMoney(check.configured)} an hour.` });
                })
              }
            >
              Re-price at {formatMoney(check.configured)}
            </button>
          )}
        </div>
      )}
      <RuleFindings findings={otherFindings} submitted />
      {mileageFindings.length > 0 && (
        <div className="notice notice--warning">
          Mileage: {mileageFindings.length} {mileageFindings.length === 1 ? 'trip is' : 'trips are'} longer than the driving route allows.{' '}
          <a href="#travel-log">See the travel log</a>.
        </div>
      )}
      {actionError && <Alert type="error" slim>{actionError}</Alert>}

      <div className="data-card">
        <table className="usa-table review-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">What was done</th>
              <th scope="col" className="amount">{lines.some(isMileage) ? 'Hours / miles' : 'Hours'}</th>
              <th scope="col" className="amount">Rate</th>
              <th scope="col" className="amount">Requested</th>
              <th scope="col">{inReview ? 'Your decision' : 'Decision'}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const decision = current(line);
              const openPanel = panel?.lineId === line.invoiceLineId ? panel.mode : null;
              return (
                <Fragment key={line.invoiceLineId}>
                  <tr className={decision?.outcomeCode === 'rejected' ? 'is-rejected' : openPanel ? 'is-open' : undefined}>
                    <td>{lineDate(line)}</td>
                    <td>
                      {lineDescription(line)}
                      <span className="cell-note">
                        {lineType(line)} · {lineTimekeeper(line)}
                        {isMileage(line) && line.tripOrigin && line.tripDestination ? ` · ${line.tripOrigin} → ${line.tripDestination}` : ''}
                      </span>
                    </td>
                    <td className="amount">{lineHours(line)}</td>
                    <td className="amount">{lineRate(line)}</td>
                    <td className="amount"><strong>{formatMoney(line.amount)}</strong></td>
                    <td className="decision-cell">{decisionCell(line)}</td>
                  </tr>
                  {openPanel && (
                    <tr className="panel-row">
                      <td colSpan={6}>
                        <DecisionPanel
                          line={line}
                          mode={openPanel}
                          reasons={reasons}
                          initial={line.working}
                          saving={saving}
                          error={actionError}
                          onCancel={() => setPanel(null)}
                          onSubmit={(input) =>
                            void decide(
                              line,
                              input,
                              input.outcome === 'rejected' ? 'rejected' : input.outcome === 'approved_in_part' ? 'approved in part' : 'approved, with a note',
                            )
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(inReview || status === 'awaiting_sign_off' || status === 'approved') && decided > 0 && (
        <div className="totals-bar">
          <dl>
            <div><dt>Requested</dt><dd className="total-figure">{formatMoney(invoice.submittedTotal)}</dd></div>
            <div><dt>Approved</dt><dd className="total-figure total-figure--good">{formatMoney(approvedCents / 100)}</dd></div>
            <div>
              <dt>Cut</dt>
              <dd className="total-figure total-figure--cut">
                {formatMoney((lines.filter((line) => current(line)).reduce((sum, line) => sum + cents(line.amount), 0) - approvedCents) / 100)}
              </dd>
            </div>
            <div>
              <dt>Lines</dt>
              <dd>{counts.approved} approved, {counts.part} in part, {counts.rejected} rejected</dd>
            </div>
          </dl>
          {inReview && decided === lines.length && isReviewer && (
            <div className="totals-bar__next">
              <p>
                {approvers.length > 0
                  ? `Next, ${approvers.map((approver) => approver.displayName).join(', then ')} ${approvers.length === 1 ? 'signs' : 'sign'} off. Then it can be exported for payment with every reason attached.`
                  : 'Choose who signs off before finishing.'}
              </p>
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving || approvers.length === 0}
                onClick={() =>
                  void act(() => finishReview(invoice.invoiceId), {
                    message: 'Review finished. It now waits for sign-off.',
                    undo: () => reopenReview(invoice.invoiceId),
                  })
                }
              >
                Finish review
              </button>
            </div>
          )}
          {inReview && decided < lines.length && (
            <p className="totals-bar__next cell-note">Decide every line to finish the review.</p>
          )}
        </div>
      )}

      {status === 'awaiting_sign_off' && (
        <section className="sign-off-panel" aria-labelledby="sign-off-heading">
          <h2 id="sign-off-heading">Sign-off</h2>
          <p>
            {nextApprover ? `Waiting for ${nextApprover.displayName} to sign off.` : 'Waiting for sign-off.'}{' '}
            Approvers sign off the whole invoice, not line by line.
          </p>
          {canSignOff && !sendingBack && (
            <div className="button-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving}
                onClick={() => void act(() => signOffInvoice(invoice.invoiceId, { outcome: 'approved' }), { message: 'Signed off.' })}
              >
                Sign off {formatMoney(approvedCents / 100)}
              </button>
              <button type="button" className="btn btn--outline" onClick={() => setSendingBack(true)}>Send back to the reviewer</button>
            </div>
          )}
          {canSignOff && sendingBack && (
            <form
              className="send-back-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act(() => signOffInvoice(invoice.invoiceId, { outcome: 'changes_requested', comment }), {
                  message: 'Sent back to the reviewer.',
                }).then((ok) => {
                  if (ok) {
                    setSendingBack(false);
                    setComment('');
                  }
                });
              }}
            >
              <label>
                What should the reviewer change?
                <textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
                <span className="cell-note">Only staff see this comment. The submitter does not.</span>
              </label>
              <div className="button-row">
                <button type="submit" className="btn btn--primary" disabled={!comment.trim() || saving}>Send back</button>
                <button type="button" className="link-button" onClick={() => setSendingBack(false)}>Cancel</button>
              </div>
            </form>
          )}
          {canReopen && (
            <button
              type="button"
              className="btn btn--outline"
              disabled={saving}
              onClick={() => void act(() => reopenReview(invoice.invoiceId), { message: 'Review reopened.' })}
            >
              Reopen review
            </button>
          )}
        </section>
      )}

      {status === 'approved' && (
        <div className="notice notice--success">
          <strong>Signed off.</strong>
          <span>
            Export the PDF or spreadsheet to send for payment. Check it for confidential information before you send it;
            this system does not remove it.
          </span>
        </div>
      )}

      {data.signOffs.length > 0 && (
        <section className="detail-section">
          <h2>Sign-off history</h2>
          <ul className="history-list">
            {data.signOffs.map((signOff, index) => (
              <li key={index}>
                {signOff.displayName ?? 'Someone'} {signOff.outcomeCode === 'approved' ? 'signed off' : 'sent it back'} on{' '}
                {formatDateTime(signOff.decidedAt)}
                {signOff.comment && <span className="cell-note">“{signOff.comment}” (staff only)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div id="travel-log">
        <TravelLog lines={lines} findings={data.ruleFindings ?? []} />
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast__undo"
              onClick={() => {
                const undo = toast.undo!;
                void act(undo, { message: 'Undone.' });
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
