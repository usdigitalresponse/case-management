import { useState, type FormEvent, type ReactNode } from 'react';
import type { DecisionReason, InvoiceReviewLine, LineDecision, LineDecisionInput } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { cents, formatMoney } from '../formatMoney';
import { StatusPill } from './StatusPill';

// A decision as recorded or in progress: what, how much, why, by whom.
export function DecisionSummary({ decision, requested }: { decision: LineDecision; requested: string }) {
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

function hasHours(line: InvoiceReviewLine): boolean {
  return line.quantity !== null && Number(line.quantity) > 0 && line.billedRate !== null && line.expenseTypeCode !== 'mileage';
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
  const [hours, setHours] = useState(initial?.approvedQuantity ?? line.quantity ?? '');
  const [rate, setRate] = useState(initial?.approvedRate ?? line.billedRate ?? '');
  const [amount, setAmount] = useState(initial?.outcomeCode === 'approved_in_part' ? (initial.approvedAmount ?? '') : '');
  const [reasonCode, setReasonCode] = useState(initial?.reasonCode ?? '');
  const [note, setNote] = useState(initial?.note ?? '');

  const requestedCents = cents(line.amount);
  const approvedCents = byHours ? cents(Number(hours) * Number(rate)) : cents(Number(amount));
  const validAmount = Number.isFinite(approvedCents) && approvedCents > 0 && approvedCents < requestedCents;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'note') {
      onSubmit({ outcome: 'approved', note: note.trim() || undefined });
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
        : `Approve part of the ${formatMoney(line.amount)} on this line`;
  const prefix = `line-${line.invoiceLineId}`;

  return (
    <form className={`decision-panel decision-panel--${mode}`} onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      <div className="decision-panel__grid">
        {mode === 'approved_in_part' && (
          <fieldset className="decision-panel__amount">
            <legend>{byHours ? 'Correct the hours or the rate' : 'Correct the amount'}</legend>
            {byHours ? (
              <div className="inline-pair">
                <label>
                  Hours
                  <input type="number" step="0.01" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
                </label>
                <span aria-hidden="true">×</span>
                <label>
                  Rate
                  <input type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
                </label>
              </div>
            ) : (
              <label>
                Amount to approve
                <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            {validAmount ? (
              <p className="decision-panel__result">
                <strong>You approve {formatMoney(approvedCents / 100)}</strong>
                <span className="cell-note">
                  Cutting {formatMoney((requestedCents - approvedCents) / 100)} from this line
                  {byHours ? `. Was ${Number(line.quantity)} hours.` : '.'}
                </span>
              </p>
            ) : (
              <p className="cell-note">Approve more than nothing and less than {formatMoney(line.amount)}.</p>
            )}
          </fieldset>
        )}
        {mode !== 'note' && (
          <fieldset>
            <legend>{mode === 'rejected' ? 'Why are you rejecting it?' : 'Why are you cutting it?'}</legend>
            {reasons.map((reason) => (
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
          disabled={saving || (mode !== 'note' && !reasonCode) || (mode === 'approved_in_part' && !validAmount) || (reasonCode === 'other' && !note.trim())}
        >
          {mode === 'note' ? 'Save note' : mode === 'rejected' ? 'Reject line' : validAmount ? `Approve ${formatMoney(approvedCents / 100)}` : 'Approve part'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export type PanelMode = 'approved_in_part' | 'rejected' | 'note';

// A line's decision column: Approve, Approve part and Reject while it is
// undecided (or being changed), else the decision with ways to change it.
export function DecisionCell({
  line,
  decision,
  inReview,
  canDecide,
  changing,
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
  openPanel: PanelMode | null;
  saving: boolean;
  onApprove: () => void;
  onPanel: (mode: PanelMode | null) => void;
  onChanging: (changing: boolean) => void;
  onUndoRejection: () => void;
}) {
  if (canDecide && (!decision || changing)) {
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
        {openPanel && <span className="cell-note decision-hint">Give a reason below</span>}
        {decision && (
          <button type="button" className="link-button" onClick={() => onChanging(false)}>
            Keep {decision.outcomeDisplayName.toLowerCase()}
          </button>
        )}
      </div>
    );
  }
  return (
    <RecordedDecision line={line} decision={decision} pending={inReview ? 'Not decided' : 'Not reviewed yet'}>
      {canDecide && decision && (
        <div className="link-row">
          {decision.outcomeCode === 'rejected' ? (
            <button type="button" className="link-button" onClick={onUndoRejection}>Undo rejection</button>
          ) : (
            <button type="button" className="link-button" onClick={() => onPanel(decision.outcomeCode === 'approved' ? 'note' : 'approved_in_part')}>
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
  line: Pick<InvoiceReviewLine, 'amount' | 'history'>;
  decision: LineDecision | null;
  pending?: string;
  children?: ReactNode;
}) {
  if (!decision) {
    return <span className="muted">{pending}</span>;
  }
  return (
    <>
      <DecisionSummary decision={decision} requested={line.amount} />
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
