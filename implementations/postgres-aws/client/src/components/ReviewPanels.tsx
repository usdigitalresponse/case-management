import { Fragment, useState } from 'react';
import type { AssignedPerson, InvoiceReviewLine, SignOff, SignOffOutcome } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import type { ReviewTotals } from '../reviewTotals';
import { ConfirmButton } from './ConfirmButton';
import { Notice } from './ui/Notice';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

// Rate check: time lines billed above the case rate a reviewer set, else the
// pre-authorized rate, else the person's approved rate, shown once above the
// table rather than on every line.
export function rateCheck(lines: InvoiceReviewLine[]) {
  const above = lines.filter(
    (line) => line.rateLimit !== null && line.billedRate !== null && Number(line.billedRate) > Number(line.rateLimit),
  );
  const sample = above[0];
  if (!sample) {
    return null;
  }
  return {
    above,
    billed: sample.billedRate as string,
    limit: sample.rateLimit as string,
    limitName: { case: "case's rate", preauthorized: 'pre-authorized rate', configured: 'approved rate' }[sample.rateLimitSource ?? 'configured'],
  };
}

export function RateCheckNotice({
  lines,
  canReprice,
  saving,
  onReprice,
}: {
  lines: InvoiceReviewLine[];
  canReprice: boolean;
  saving: boolean;
  onReprice: (rate: string) => void;
}) {
  const check = rateCheck(lines);
  if (!check) {
    return null;
  }
  return (
    <Notice
      tone="warning"
      action={
        canReprice && (
          <Button kind="secondary" disabled={saving} onClick={() => onReprice(check.limit)}>
            Re-price at {formatMoney(check.limit)}
          </Button>
        )
      }
    >
      Rate check: {check.above.length === 1 ? 'one line bills' : `${check.above.length} lines bill`} {formatMoney(check.billed)} an
      hour, above the {check.limitName} of {formatMoney(check.limit)}.
      {canReprice && ` Re-pricing approves those lines in part at ${formatMoney(check.limit)}.`}
    </Notice>
  );
}

// Requested, approved, cut and line counts, for the totals bar and the Finish dialog.
function totalsFigures(requested: string, totals: ReviewTotals) {
  const { counts } = totals;
  return [
    { term: 'Requested', value: formatMoney(requested), tone: '' },
    { term: 'Approved', value: formatMoney(totals.approved / 100), tone: 'good' },
    // Raised rates can approve more than was asked for.
    { term: totals.cut < 0 ? 'Added' : 'Cut', value: formatMoney(Math.abs(totals.cut) / 100), tone: 'cut' },
    { term: 'Lines', value: `${counts.approved} approved, ${counts.part} in part, ${counts.rejected} rejected`, tone: null },
  ];
}

// Requested, approved and cut so far, and Finish review once every line is
// decided.
export function TotalsBar({
  requested,
  totals,
  lineCount,
  inReview,
  canFinish,
  approvers,
  saving,
  onFinish,
  locksLines = false,
  needs = null,
}: {
  requested: string;
  totals: ReviewTotals;
  lineCount: number;
  inReview: boolean;
  canFinish: boolean;
  approvers: AssignedPerson[];
  saving: boolean;
  onFinish: () => void;
  // Entered in review: finishing also locks the lines, for good.
  locksLines?: boolean;
  // What is still needed before finishing, shown in place of the button.
  needs?: string | null;
}) {
  const figures = totalsFigures(requested, totals);
  const [confirming, setConfirming] = useState(false);
  const signers = approvers.map((approver) => approver.displayName).join(', then ');
  return (
    <div className="card totals-bar">
      <dl>
        {figures.map(({ term, value, tone }) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd className={tone === null ? undefined : `total-figure${tone ? ` total-figure--${tone}` : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {inReview && totals.decided === lineCount && canFinish && needs && <p className="totals-bar__next cell-note">{needs}</p>}
      {inReview && totals.decided === lineCount && canFinish && !needs && !confirming && (
        <div className="totals-bar__next">
          <p>
            {approvers.length > 0
              ? `Next, ${signers} ${approvers.length === 1 ? 'signs' : 'sign'} off. Then it can be exported for payment with every reason attached.`
              : 'Choose who signs off before finishing.'}
          </p>
          <Button kind="primary" disabled={saving || approvers.length === 0} onClick={() => setConfirming(true)}>
            Finish review
          </Button>
        </div>
      )}
      {confirming && (
        <Dialog title="Finish this review?" onClose={() => setConfirming(false)}>
          <dl className="send-summary">
            {figures.map(({ term, value, tone }) => (
              <Fragment key={term}>
                <dt>{term}</dt>
                <dd>{tone === 'good' ? <strong>{value}</strong> : value}</dd>
              </Fragment>
            ))}
          </dl>
          <p>
            {locksLines ? 'The lines lock as you entered them, and so do the decisions. ' : 'The decisions lock. '}
            The invoice goes to {signers} to sign off. You can reopen the review until
            {approvers.length === 1 ? ' they sign' : ' the first of them signs'}
            {locksLines ? ', to change decisions but not the lines.' : '.'}
          </p>
          <div className="dialog__actions">
            <Button
              kind="primary"
              disabled={saving}
              ref={(element) => element?.focus()}
              onClick={() => {
                setConfirming(false);
                onFinish();
              }}
            >
              Finish review
            </Button>
            <button type="button" className="link-button" onClick={() => setConfirming(false)}>Keep reviewing</button>
          </div>
        </Dialog>
      )}
      {inReview && totals.decided < lineCount && <p className="totals-bar__next cell-note">Decide every line to finish the review.</p>}
    </div>
  );
}

// Waiting for sign-off: the approver signs off or rejects the whole invoice,
// with a comment shared like line notes, or sends it back with one only staff
// see; staff can reopen until then.
export function SignOffPanel({
  nextApprover,
  approvedCents,
  canSignOff,
  canReopen,
  saving,
  onDecide,
  onReopen,
}: {
  nextApprover: AssignedPerson | null;
  approvedCents: number;
  canSignOff: boolean;
  canReopen: boolean;
  saving: boolean;
  // Resolves true once recorded.
  onDecide: (outcome: SignOffOutcome, comment: string) => Promise<boolean>;
  onReopen: () => void;
}) {
  const [comment, setComment] = useState('');
  const decide = (outcome: SignOffOutcome) =>
    void onDecide(outcome, comment.trim()).then((done) => {
      if (done) setComment('');
    });

  return (
    <section className="card sign-off-panel" aria-labelledby="sign-off-heading">
      <h2 id="sign-off-heading">Sign-off</h2>
      <p>
        {nextApprover ? `Waiting for ${nextApprover.displayName} to sign off.` : 'Waiting for sign-off.'} Approvers decide the
        whole invoice, not line by line.
      </p>
      {canSignOff && (
        <label className="send-back-form">
          Comment (needed to send it back)
          <textarea className="usa-textarea" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
          <span className="cell-note">
            Signing off or rejecting, everyone who sees the invoice sees it, as with line notes. Sending it back, only staff do.
          </span>
        </label>
      )}
      {(canSignOff || canReopen) && (
        <div className="button-row">
          {canSignOff && (
            <>
              <Button kind="primary" disabled={saving} onClick={() => decide('approved')}>
                Sign off {formatMoney(approvedCents / 100)}
              </Button>
              <ConfirmButton
                label="Reject invoice"
                prompt="Reject the whole invoice? Nothing on it will be approved."
                confirmLabel="Reject it"
                disabled={saving}
                onConfirm={() => decide('rejected')}
              />
              <Button kind="secondary" disabled={saving || !comment.trim()} onClick={() => decide('changes_requested')}>
                Send back to the reviewer
              </Button>
            </>
          )}
          {canReopen && (
            <Button kind="secondary" disabled={saving} onClick={onReopen}>
              Reopen review
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

const SIGN_OFF_WORDS: Record<string, string> = { approved: 'signed off', rejected: 'rejected the invoice', changes_requested: 'sent it back' };

export function SignOffHistory({ signOffs }: { signOffs: SignOff[] }) {
  if (signOffs.length === 0) {
    return null;
  }
  return (
    <section className="detail-section">
      <h2>Sign-off history</h2>
      <ul className="history-list">
        {signOffs.map((signOff, index) => (
          <li key={index}>
            {signOff.displayName ?? 'Someone'} {SIGN_OFF_WORDS[signOff.outcomeCode] ?? 'decided'} on{' '}
            {formatDateTime(signOff.decidedAt)}
            {signOff.comment && (
              <span className="cell-note">
                “{signOff.comment}” ({signOff.internalOnly ? 'staff only' : 'the sender sees it'})
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
