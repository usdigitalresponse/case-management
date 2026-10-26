import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  apiErrorMessage,
  decideInvoiceLine,
  finishReview,
  getInvoiceForReview,
  listDecisionReasons,
  reopenReview,
  repriceInvoice,
  signOffInvoice,
  undoInvoiceLineDecision,
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
import { DecisionCell, DecisionPanel, decisionInput, type PanelMode } from '../components/LineReview';
import { ReviewerPicker, SignOffApprovers } from '../components/ReviewRouting';
import { RateCheckNotice, SignOffHistory, SignOffPanel, TotalsBar } from '../components/ReviewPanels';
import { InvoiceLinesTable, lineRowClass } from '../components/InvoiceLinesTable';
import { PageHeader } from '../components/PageHeader';
import { Fact, FactsStrip, Progress } from '../components/FactsStrip';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/Notice';
import { Toast, useToast, type ToastMessage } from '../components/Toast';
import { formatDate, formatDateTime, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { reviewTotals, submittedByLabel } from '../reviewTotals';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';

export default function InvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { user } = useAuth();
  const permissions = user?.reviewPermissions;
  const { data: loaded, error } = useApiResource(() => getInvoiceForReview(invoiceId as string), [invoiceId]);
  const { data: reasonData } = useApiResource(() => listDecisionReasons(), []);
  // Refreshed in place after each action, so open panels aren't unmounted.
  const [refreshed, setRefreshed] = useState<InvoiceReviewData | null>(null);
  const latestRequest = useRef(0);
  const data = refreshed?.invoice.invoiceId === invoiceId ? refreshed : loaded;

  const [panel, setPanel] = useState<{ lineId: string; mode: PanelMode } | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  useEffect(() => {
    latestRequest.current += 1;
    setRefreshed(null);
    setPanel(null);
    setToast(null);
  }, [invoiceId, setToast]);

  function refresh() {
    const request = ++latestRequest.current;
    return getInvoiceForReview(invoiceId as string).then((result) => {
      if (request === latestRequest.current) setRefreshed(result);
    });
  }

  // Runs an action, then shows `next` (or what it returns) and reloads.
  async function act<T>(action: () => Promise<T>, next?: ToastMessage | ((result: T) => ToastMessage)) {
    setSaving(true);
    setActionError(null);
    try {
      const result = await action();
      setPanel(null);
      setChanging(null);
      setToast(typeof next === 'function' ? next(result) : (next ?? null));
      await refresh();
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err, 'That did not save. Try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (error || !data) {
    return <LoadState error={error} what="invoice" />;
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
  const totals = reviewTotals(lines, current);
  const everyLineDecided = inReview && lines.length > 0 && totals.decided === lines.length;
  const ruleFindings = data.ruleFindings ?? [];
  const mileageFindings = ruleFindings.filter((finding) => finding.rule === 'mileage_distance');

  const approvers = assignments?.signOff ?? [];
  const sentBack = status === 'under_review' ? data.signOffs.filter((s) => s.outcomeCode === 'changes_requested').at(-1) : undefined;
  const onRoutingChanged = (message: string, undo?: () => Promise<unknown>) => {
    setToast({ message, undo });
    void refresh();
  };

  async function decide(line: InvoiceReviewLine, input: LineDecisionInput, label: string) {
    const previous = line.working;
    await act(() => decideInvoiceLine(invoice.invoiceId, line.invoiceLineId, input), {
      message: `Line ${lineNumber.get(line.invoiceLineId)} ${label}.`,
      undo: () =>
        previous
          ? decideInvoiceLine(invoice.invoiceId, line.invoiceLineId, decisionInput(previous))
          : undoInvoiceLineDecision(invoice.invoiceId, line.invoiceLineId),
    });
  }

  const openPanel = (line: InvoiceReviewLine) => (panel?.lineId === line.invoiceLineId ? panel.mode : null);

  return (
    <div className="invoice-review">
      <PageHeader
        crumbs={[
          { label: 'Invoices', to: '/' },
          invoice.caseId ? { label: invoice.caseClientDisplayName ?? 'Case', to: `/cases/${invoice.caseId}` } : { label: 'No case' },
          { label: `Invoice ${invoice.invoiceId.slice(0, 8)}` },
        ]}
        title={invoice.caseId ? (invoice.caseClientDisplayName ?? 'Unknown client') : `Invoice from ${invoice.professionalDisplayName ?? 'an unknown provider'}`}
        status={
          <StatusPill
            code={everyLineDecided ? 'every_line_decided' : status}
            label={everyLineDecided ? 'Every line decided' : invoice.statusDisplayName}
          />
        }
        meta={
          <>
            <strong>Case {data.caseNumber ?? '—'}</strong>
            <span>
              {invoice.professionalKindDisplayName ?? 'Professional'} invoice from {submittedByLabel(invoice)}
            </span>
            {invoice.receivedOn && (
              <span>
                Received {invoice.receivedViaDisplayName ? `by ${invoice.receivedViaDisplayName.toLowerCase()} ` : ''}on{' '}
                {formatDate(invoice.receivedOn)}
              </span>
            )}
            <button type="button" className="link-button" disabled title="Not connected yet">
              Open the case in your {EXTERNAL_SYSTEM_NAME} ↗
            </button>
          </>
        }
        actions={
          <>
            <ReviewerPicker
              invoiceId={invoice.invoiceId}
              reviewer={reviewer}
              currentUserId={userId}
              canChange={inReview && Boolean(permissions?.reassign)}
              onChanged={onRoutingChanged}
            />
            <InvoiceExportLinks scope="staff" invoiceId={invoice.invoiceId} />
          </>
        }
      />

      <FactsStrip>
        <Fact label="Case number" note={data.otherCaseNumbers.join(', ') || undefined}>
          <strong>{data.caseNumber ?? '—'}</strong>
        </Fact>
        <Fact label="Submitted">
          <strong>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : '—'}</strong>
        </Fact>
        <Fact label="Billing period">{formatPeriod(invoice.periodStart, invoice.periodEnd)}</Fact>
        <Fact label="Requested">
          <strong>{formatMoney(invoice.submittedTotal)}</strong>
        </Fact>
        <Fact label="Approved so far" note={totals.cut > 0 ? `${formatMoney(totals.cut / 100)} cut` : undefined}>
          {formatMoney(totals.approved / 100)}
        </Fact>
        <Fact
          label="Pre-authorized"
          note={
            data.preauthorization &&
            `${formatMoney(data.preauthorization.approvedSoFar)} approved, ${formatMoney(data.preauthorization.waiting)} waiting`
          }
        >
          {data.preauthorization ? <strong>{formatMoney(data.preauthorization.ceiling)}</strong> : 'None'}
        </Fact>
        <Fact label="Lines decided">
          <Progress done={totals.decided} total={lines.length} />
        </Fact>
      </FactsStrip>

      {invoice.caseId === null && (
        <Notice tone="warning" heading="Not linked to a case.">
          Staff chose to review this invoice without one. This system didn't check the case, whether{' '}
          {invoice.professionalDisplayName ?? 'the provider'} is assigned to it, or any pre-authorization. Exports and the billing
          record say so.
        </Notice>
      )}

      {inReview && (
        <SignOffApprovers
          invoiceId={invoice.invoiceId}
          approvers={approvers}
          canChange={isReviewer || Boolean(permissions?.changeSettings) || (!reviewer && Boolean(permissions?.reviewLines))}
          onChanged={onRoutingChanged}
        />
      )}

      {sentBack && (
        <Notice tone="info" heading={`Sent back by ${sentBack.displayName ?? 'the approver'} on ${formatDateTime(sentBack.decidedAt)}.`}>
          {sentBack.comment && <>“{sentBack.comment}” Only staff see this comment.</>}
        </Notice>
      )}

      <RateCheckNotice
        lines={lines}
        canReprice={canDecide}
        saving={saving}
        onReprice={(configured) =>
          void act(
            () => repriceInvoice(invoice.invoiceId),
            ({ repriced }) => ({
              message: `${repriced} ${repriced === 1 ? 'line' : 'lines'} re-priced at ${formatMoney(configured)} an hour.`,
            }),
          )
        }
      />
      <RuleFindings findings={ruleFindings.filter((finding) => finding.rule !== 'mileage_distance')} submitted />
      {mileageFindings.length > 0 && (
        <Notice tone="warning">
          Mileage: {mileageFindings.length} {mileageFindings.length === 1 ? 'trip is' : 'trips are'} longer than the driving route
          allows. <a href="#travel-log">See the travel log</a>.
        </Notice>
      )}
      {actionError && <Notice tone="danger">{actionError}</Notice>}

      <InvoiceLinesTable
        lines={lines}
        decisionHeader={inReview ? 'Your decision' : 'Decision'}
        rowClassName={(line) => lineRowClass(current(line)?.outcomeCode, Boolean(openPanel(line)))}
        decision={(line) => (
          <DecisionCell
            line={line}
            decision={current(line)}
            inReview={inReview}
            canDecide={canDecide}
            changing={changing === line.invoiceLineId}
            openPanel={openPanel(line)}
            saving={saving}
            onApprove={() => void decide(line, { outcome: 'approved' }, 'approved')}
            onPanel={(mode) => setPanel(mode ? { lineId: line.invoiceLineId, mode } : null)}
            onChanging={(on) => setChanging(on ? line.invoiceLineId : null)}
            onUndoRejection={() =>
              void act(() => undoInvoiceLineDecision(invoice.invoiceId, line.invoiceLineId), {
                message: 'Rejection undone. The line is undecided.',
              })
            }
          />
        )}
        rowDetail={(line) => {
          const mode = openPanel(line);
          return (
            mode && (
              <DecisionPanel
                line={line}
                mode={mode}
                reasons={reasonData?.reasons ?? []}
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
            )
          );
        }}
      />

      {(inReview || status === 'awaiting_sign_off' || status === 'approved') && totals.decided > 0 && (
        <TotalsBar
          requested={invoice.submittedTotal}
          totals={totals}
          lineCount={lines.length}
          inReview={inReview}
          canFinish={isReviewer}
          approvers={approvers}
          saving={saving}
          onFinish={() =>
            void act(() => finishReview(invoice.invoiceId), {
              message: `Review finished. It went to ${approvers[0]?.displayName ?? 'the approver'} to sign off.`,
              undo: () => reopenReview(invoice.invoiceId),
            })
          }
        />
      )}

      {status === 'awaiting_sign_off' && (
        <SignOffPanel
          nextApprover={data.nextSignOff}
          approvedCents={totals.approved}
          canSignOff={Boolean(permissions?.signOff) && data.nextSignOff?.userAccountId === userId}
          canReopen={isReviewer && !data.signOffStarted}
          saving={saving}
          onSignOff={() => void act(() => signOffInvoice(invoice.invoiceId, { outcome: 'approved' }), { message: 'Signed off.' })}
          onSendBack={(comment) =>
            act(() => signOffInvoice(invoice.invoiceId, { outcome: 'changes_requested', comment }), {
              message: 'Sent back to the reviewer.',
            })
          }
          onReopen={() => void act(() => reopenReview(invoice.invoiceId), { message: 'Review reopened.' })}
        />
      )}

      {status === 'approved' && (
        <Notice tone="success" heading="Signed off.">
          Export the PDF or spreadsheet to send for payment. Check it for confidential information before you send it; this
          system does not remove it.
        </Notice>
      )}

      <SignOffHistory signOffs={data.signOffs} />

      <div id="travel-log">
        <TravelLog lines={lines} findings={ruleFindings} />
      </div>

      <Toast toast={toast} onUndo={(undo) => void act(undo, { message: 'Undone.' })} />
    </div>
  );
}
