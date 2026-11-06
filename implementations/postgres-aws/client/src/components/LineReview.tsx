import { useState, type FormEvent, type ReactNode } from 'react';
import type { DecisionReason, InvoiceReviewLine, LineDecision, LineDecisionInput } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { cents, formatMoney, formatRate } from '../formatMoney';
import { isMileage } from '../invoiceLineDisplay';
import { StatusPill } from './StatusPill';

// A decision as recorded or in progress: what, how much, why, by whom, and
// a corrected rate that differs from the line's default.
export function DecisionSummary({
  decision,
  requested,
  defaultRate = null,
}: {
  decision: LineDecision;
  requested: string;
  defaultRate?: string | null;
}) {
  const rateDiffers = decision.approvedRate && defaultRate !== null && Number(decision.approvedRate) !== Number(defaultRate);
  return (
    <div className="decision-summary">
      <div className="decision-summary__head">
        <StatusPill code={decision.outcomeCode} label={decision.outcomeDisplayName} />
        {decision.outcomeCode === 'approved_in_part' ? (
          <strong>
            {formatMoney(decision.approvedAmount)} of {formatMoney(requested)}
          </strong>
        ) : decision.outcomeCode === 'approved' ? (
          <strong>{formatMoney(decision.approvedAmount)}</strong>
        ) : null}
      </div>
      {rateDiffers && (
        <p className="line-rate-differs">
          At {formatRate(decision.approvedRate!)}, not the default {formatRate(defaultRate!)}
        </p>
      )}
      {(decision.reasonDisplayName || decision.note) && (
        <p className="decision-summary__why">{[decision.reasonDisplayName, decision.note].filter(Boolean).join('. ')}</p>
      )}
      {/* Submitters don't see who decided. */}
      <p className="cell-note">
        {[decision.decidedByDisplayName, formatDateTime(decision.decidedAt)].filter(Boolean).join(', ')}
      </p>
    </div>
  );
}

export function DecisionHistory({ line }: { line: Pick<InvoiceReviewLine, 'history'> }) {
  const [open, setOpen] = useState(false);
  if (line.history.length === 0) {
    return null;
  }
  return (
    <div className="decision-history">
      <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide history' : 'See history'}
      </button>
      {open && (
        <ol>
          {line.history.map((past) => (
            <li key={past.round}>
              Round {past.round}: {past.outcomeDisplayName}
              {past.outcomeCode === 'approved_in_part' ? `, ${formatMoney(past.approvedAmount)}` : ''}
              {past.reasonDisplayName ? `. ${past.reasonDisplayName}` : ''}
              {past.note ? `. ${past.note}` : ''} ({[past.decidedByDisplayName, formatDateTime(past.decidedAt)].filter(Boolean).join(', ')})
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Time, travel time and mileage: corrected by quantity and rate.
function hasHours(line: InvoiceReviewLine): boolean {
  return line.quantity !== null && Number(line.quantity) > 0 && line.billedRate !== null;
}

// Approve part (corrected hours or rate, or the amount) or reject: both ask
// why. The note is seen by everyone who can see the invoice.
export function DecisionPanel({
  line,
  mode,
  reasons,
  initial,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  line: InvoiceReviewLine;
  mode: PanelMode;
  reasons: DecisionReason[];
  initial: LineDecision | null;
  saving: boolean;
  error: string | null;
  onSubmit: (input: LineDecisionInput) => void;
  onCancel: () => void;
}) {
  const byHours = hasHours(line);
  const miles = isMileage(line);
  const [hours, setHours] = useState(initial?.approvedQuantity ?? line.quantity ?? '');
  const [rate, setRate] = useState(initial?.approvedRate ?? line.billedRate ?? '');
  const [amount, setAmount] = useState(initial?.outcomeCode === 'approved_in_part' ? (initial.approvedAmount ?? '') : '');
  const [picked, setReasonCode] = useState(initial?.reasonCode ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  // Approving in part and rejecting have their own lists; a reason kept from
  // a decision on the other list doesn't carry over.
  const options = reasons.filter((reason) => reason.appliesTo === 'both' || reason.appliesTo === mode);
  const reasonCode = options.some((reason) => reason.code === picked) ? picked : '';

  const requestedCents = cents(line.amount);
  const approvedCents = byHours ? cents(Number(hours) * Number(rate)) : cents(Number(amount));
  const validAmount = Number.isFinite(approvedCents) && approvedCents > 0 && approvedCents < requestedCents;
  // The same hours at a higher rate approve more than was asked: no reason
  // is needed, and sign-off sees the changed rate flagged.
  const raised =
    mode === 'approved_in_part' &&
    byHours &&
    Number(hours) === Number(line.quantity) &&
    Number(rate) > 0 &&
    Number(rate) !== Number(line.billedRate) &&
    approvedCents >= requestedCents;
  const needsReason = mode === 'rejected' || (mode === 'approved_in_part' && !raised);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'note') {
      // An approval at a changed rate, higher or lower, keeps it.
      const kept =
        initial?.outcomeCode === 'approved' && initial.approvedRate
          ? { approvedRate: Number(initial.approvedRate), approvedQuantity: initial.approvedQuantity ? Number(initial.approvedQuantity) : undefined }
          : {};
      onSubmit({ outcome: 'approved', ...kept, note: note.trim() || undefined });
      return;
    }
    if (raised) {
      onSubmit({ outcome: 'approved', approvedRate: Number(rate), note: note.trim() || undefined });
      return;
    }
    const base = { reasonCode, note: note.trim() || undefined };
    if (mode === 'rejected') {
      onSubmit({ outcome: 'rejected', ...base });
      return;
    }
    onSubmit(
      byHours
        ? { outcome: 'approved_in_part', approvedQuantity: Number(hours), approvedRate: Number(rate), ...base }
        : { outcome: 'approved_in_part', approvedAmount: Number(amount), ...base },
    );
  }

  const title =
    mode === 'note'
      ? 'Add a note to this approval'
      : mode === 'rejected'
        ? `Reject the ${formatMoney(line.amount)} on this line`
        : byHours
          ? `Approve part of the ${formatMoney(line.amount)} on this line, or change its rate`
          : `Approve part of the ${formatMoney(line.amount)} on this line`;
  const prefix = `line-${line.invoiceLineId}`;

  return (
    <form className={`decision-panel decision-panel--${mode}`} onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      <div className="decision-panel__grid">
        {mode === 'approved_in_part' && (
          <fieldset className="decision-panel__amount">
            <legend>{byHours ? `Correct the ${miles ? 'miles' : 'hours'} or the rate` : 'Correct the amount'}</legend>
            {byHours ? (
              <div className="inline-pair">
                <label>
                  {miles ? 'Miles' : 'Hours'}
                  <input type="number" step="0.01" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
                </label>
                <span aria-hidden="true">×</span>
                <label>
                  Rate{miles ? ' per mile' : ''}
                  <input type="number" step={miles ? '0.001' : '0.01'} min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
                </label>
                {line.configuredRate !== null && rate !== '' && Number(rate) !== Number(line.configuredRate) && (
                  <span className="line-rate-differs">Differs from the default {formatRate(line.configuredRate)}</span>
                )}
              </div>
            ) : (
              <label>
                Amount to approve
                <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            {raised ? (
              <p className="decision-panel__result">
                <strong>You approve {formatMoney(approvedCents / 100)}</strong>
                <span className="cell-note">
                  {Number(line.quantity)} {miles ? 'miles' : 'hours'} at {formatRate(rate)}, instead of {formatMoney(line.amount)} at{' '}
                  {formatRate(line.billedRate ?? '0')}. No reason needed; sign-off sees the changed rate flagged.
                </span>
              </p>
            ) : validAmount ? (
              <p className="decision-panel__result">
                <strong>You approve {formatMoney(approvedCents / 100)}</strong>
                <span className="cell-note">
                  Cutting {formatMoney((requestedCents - approvedCents) / 100)} from this line
                  {byHours ? `. Was ${Number(line.quantity)} ${miles ? 'miles' : 'hours'} at ${formatRate(line.billedRate ?? '0')}.` : '.'}
                </span>
              </p>
            ) : (
              <p className="cell-note">
                {byHours
                  ? `Approve less than ${formatMoney(line.amount)}, or keep the ${miles ? 'miles' : 'hours'} and raise the rate.`
                  : `Approve more than nothing and less than ${formatMoney(line.amount)}.`}
              </p>
            )}
          </fieldset>
        )}
        {needsReason && (
          <fieldset>
            <legend>{mode === 'rejected' ? 'Why are you rejecting it?' : 'Why are you cutting it?'}</legend>
            {options.map((reason) => (
              <label key={reason.code} className="radio-row">
                <input
                  type="radio"
                  name={`${prefix}-reason`}
                  value={reason.code}
                  checked={reasonCode === reason.code}
                  onChange={() => setReasonCode(reason.code)}
                />
                {reason.displayName}
              </label>
            ))}
          </fieldset>
        )}
        <label className="decision-panel__note">
          Note for the record{reasonCode === 'other' ? '' : ' (optional)'}
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <span className="cell-note">Everyone who sees the invoice sees this note.</span>
        </label>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="button-row">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={
            saving ||
            (needsReason && !reasonCode) ||
            (mode === 'approved_in_part' && !validAmount && !raised) ||
            (reasonCode === 'other' && !note.trim())
          }
        >
          {mode === 'note'
            ? 'Save note'
            : mode === 'rejected'
              ? 'Reject line'
              : validAmount || raised
                ? `Approve ${formatMoney(approvedCents / 100)}`
                : 'Approve part'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
        {needsReason && !reasonCode && <span className="cell-note">Choose a reason first.</span>}
      </div>
    </form>
  );
}

export type PanelMode = 'approved_in_part' | 'rejected' | 'note';

// Approved at a rate other than the one billed.
export function rateChanged(line: Pick<InvoiceReviewLine, 'billedRate'>, decision: LineDecision | null): boolean {
  return Boolean(decision?.approvedRate) && Number(decision!.approvedRate) !== Number(line.billedRate);
}

// A line's decision column: Approve, Approve part and Reject while it is
// undecided (or being changed), else the decision with ways to change it.
export function DecisionCell({
  line,
  decision,
  inReview,
  canDecide,
  changing,
  edited = false,
  openPanel,
  saving,
  onApprove,
  onPanel,
  onChanging,
  onUndoRejection,
}: {
  line: InvoiceReviewLine;
  decision: LineDecision | null;
  inReview: boolean;
  canDecide: boolean;
  changing: boolean;
  // Changed and not saved yet: saving undoes its decision, so it is decided again.
  edited?: boolean;
  openPanel: PanelMode | null;
  saving: boolean;
  onApprove: () => void;
  onPanel: (mode: PanelMode | null) => void;
  onChanging: (changing: boolean) => void;
  onUndoRejection: () => void;
}) {
  if (canDecide && (!decision || changing || edited)) {
    const toggle = (mode: PanelMode) => onPanel(openPanel === mode ? null : mode);
    return (
      <div className="decision-buttons">
        <div className="decision-button-row">
          <button type="button" className="btn btn--outline" disabled={saving} onClick={onApprove}>
            Approve
          </button>
          <button
            type="button"
            className={`btn ${openPanel === 'approved_in_part' ? 'btn--primary' : 'btn--outline'}`}
            aria-expanded={openPanel === 'approved_in_part'}
            onClick={() => toggle('approved_in_part')}
          >
            Approve part
          </button>
          <button
            type="button"
            className={`btn ${openPanel === 'rejected' ? 'btn--danger-solid' : 'btn--danger'}`}
            aria-expanded={openPanel === 'rejected'}
            onClick={() => toggle('rejected')}
          >
            Reject
          </button>
        </div>
        {openPanel && <span className="cell-note decision-hint">{openPanel === 'rejected' ? 'Give a reason below' : 'Correct it below'}</span>}
        {decision && edited ? (
          <span className="cell-note">Was {decision.outcomeDisplayName.toLowerCase()}. Decide it again.</span>
        ) : (
          decision && (
            <button type="button" className="link-button" onClick={() => onChanging(false)}>
              Keep {decision.outcomeDisplayName.toLowerCase()}
            </button>
          )
        )}
      </div>
    );
  }
  return (
    <RecordedDecision line={line} decision={decision} pending={inReview ? 'Not decided' : 'Not reviewed yet'}>
      {canDecide && decision && (
        <div className="link-row">
          {decision.outcomeCode === 'rejected' ? (
            <>
              <button type="button" className="link-button" onClick={onUndoRejection}>Undo rejection</button>
              <button type="button" className="link-button" onClick={() => onPanel('rejected')}>Edit reason</button>
            </>
          ) : (
            <button
              type="button"
              className="link-button"
              // A changed rate keeps its rate when its note is edited.
              onClick={() => onPanel(decision.outcomeCode === 'approved' ? 'note' : 'approved_in_part')}
            >
              {decision.note ? 'Edit note' : 'Add a note'}
            </button>
          )}
          <button type="button" className="link-button" onClick={() => onChanging(true)}>Change</button>
        </div>
      )}
    </RecordedDecision>
  );
}

// A decision as it stands, with any actions on it, then earlier rounds.
export function RecordedDecision({
  line,
  decision,
  pending = 'Not reviewed yet',
  children,
}: {
  line: Pick<InvoiceReviewLine, 'amount' | 'history' | 'configuredRate'>;
  decision: LineDecision | null;
  pending?: string;
  children?: ReactNode;
}) {
  if (!decision) {
    return <span className="muted">{pending}</span>;
  }
  return (
    <>
      <DecisionSummary decision={decision} requested={line.amount} defaultRate={line.configuredRate} />
      {children}
      <DecisionHistory line={line} />
    </>
  );
}

// The decision the reviewer just replaced, to put back on Undo.
export function decisionInput(previous: LineDecision): LineDecisionInput {
  return {
    outcome: previous.outcomeCode,
    approvedAmount: previous.approvedQuantity ? undefined : Number(previous.approvedAmount ?? 0) || undefined,
    approvedQuantity: previous.approvedQuantity ? Number(previous.approvedQuantity) : undefined,
    approvedRate: previous.approvedRate ? Number(previous.approvedRate) : undefined,
    reasonCode: previous.reasonCode ?? undefined,
    note: previous.note ?? undefined,
  };
}
