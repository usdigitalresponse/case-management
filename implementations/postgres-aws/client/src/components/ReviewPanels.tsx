import { useState } from 'react';
import type { AssignedPerson, InvoiceReviewLine, SignOff } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import type { ReviewTotals } from '../reviewTotals';
import { Notice } from './Notice';

// Rate check: lines billed at a rate other than the configured one, shown
// once above the table rather than on every line.
export function rateCheck(lines: InvoiceReviewLine[]) {
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

export function RateCheckNotice({
  lines,
  canReprice,
  saving,
  onReprice,
}: {
  lines: InvoiceReviewLine[];
  canReprice: boolean;
  saving: boolean;
  onReprice: (configuredRate: string) => void;
}) {
  const check = rateCheck(lines);
  if (!check) {
    return null;
  }
  const offer = canReprice && check.above.length > 0;
  return (
    <Notice
      tone="warning"
      action={
        offer && (
          <button type="button" className="btn btn--outline" disabled={saving} onClick={() => onReprice(check.configured)}>
            Re-price at {formatMoney(check.configured)}
          </button>
        )
      }
    >
      Rate check: {check.differing.length === 1 ? 'one line is' : `${check.differing.length} lines are`} billed at{' '}
      {formatMoney(check.billed)} an hour; the configured rate is {formatMoney(check.configured)} an hour.
      {offer && ' Re-pricing approves those lines in part at the configured rate.'}
    </Notice>
  );
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
}: {
  requested: string;
  totals: ReviewTotals;
  lineCount: number;
  inReview: boolean;
  canFinish: boolean;
  approvers: AssignedPerson[];
  saving: boolean;
  onFinish: () => void;
}) {
  const { counts } = totals;
  return (
    <div className="totals-bar">
      <dl>
        <div><dt>Requested</dt><dd className="total-figure">{formatMoney(requested)}</dd></div>
        <div><dt>Approved</dt><dd className="total-figure total-figure--good">{formatMoney(totals.approved / 100)}</dd></div>
        <div><dt>Cut</dt><dd className="total-figure total-figure--cut">{formatMoney(totals.cut / 100)}</dd></div>
        <div>
          <dt>Lines</dt>
          <dd>{counts.approved} approved, {counts.part} in part, {counts.rejected} rejected</dd>
        </div>
      </dl>
      {inReview && totals.decided === lineCount && canFinish && (
        <div className="totals-bar__next">
          <p>
            {approvers.length > 0
              ? `Next, ${approvers.map((approver) => approver.displayName).join(', then ')} ${approvers.length === 1 ? 'signs' : 'sign'} off. Then it can be exported for payment with every reason attached.`
              : 'Choose who signs off before finishing.'}
          </p>
          <button type="button" className="btn btn--primary" disabled={saving || approvers.length === 0} onClick={onFinish}>
            Finish review
          </button>
        </div>
      )}
      {inReview && totals.decided < lineCount && <p className="totals-bar__next cell-note">Decide every line to finish the review.</p>}
    </div>
  );
}

// Waiting for sign-off: the approver signs off the whole invoice or sends it
// back with a comment only staff see; the reviewer can reopen until then.
export function SignOffPanel({
  nextApprover,
  approvedCents,
  canSignOff,
  canReopen,
  saving,
  onSignOff,
  onSendBack,
  onReopen,
}: {
  nextApprover: AssignedPerson | null;
  approvedCents: number;
  canSignOff: boolean;
  canReopen: boolean;
  saving: boolean;
  onSignOff: () => void;
  // Resolves true once sent.
  onSendBack: (comment: string) => Promise<boolean>;
  onReopen: () => void;
}) {
  const [sendingBack, setSendingBack] = useState(false);
  const [comment, setComment] = useState('');

  return (
    <section className="sign-off-panel" aria-labelledby="sign-off-heading">
      <h2 id="sign-off-heading">Sign-off</h2>
      <p>
        {nextApprover ? `Waiting for ${nextApprover.displayName} to sign off.` : 'Waiting for sign-off.'} Approvers sign off the
        whole invoice, not line by line.
      </p>
      {canSignOff && !sendingBack && (
        <div className="button-row">
          <button type="button" className="btn btn--primary" disabled={saving} onClick={onSignOff}>
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
            void onSendBack(comment).then((sent) => {
              if (sent) {
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
        <button type="button" className="btn btn--outline" disabled={saving} onClick={onReopen}>
          Reopen review
        </button>
      )}
    </section>
  );
}

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
            {signOff.displayName ?? 'Someone'} {signOff.outcomeCode === 'approved' ? 'signed off' : 'sent it back'} on{' '}
            {formatDateTime(signOff.decidedAt)}
            {signOff.comment && <span className="cell-note">“{signOff.comment}” (staff only)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
