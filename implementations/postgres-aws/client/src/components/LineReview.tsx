import { useState, type FormEvent } from 'react';
import type { DecisionReason, InvoiceReviewLine, LineDecision, LineDecisionInput } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';

const PILL_CLASS: Record<string, string> = {
  approved: 'chip--success',
  approved_in_part: 'chip--warning',
  rejected: 'chip--danger',
};

export function DecisionChip({ decision }: { decision: Pick<LineDecision, 'outcomeCode' | 'outcomeDisplayName'> }) {
  return <span className={`chip ${PILL_CLASS[decision.outcomeCode] ?? ''}`}>{decision.outcomeDisplayName}</span>;
}

// A decision as recorded or in progress: what, how much, why, by whom.
export function DecisionSummary({ decision, requested }: { decision: LineDecision; requested: string }) {
  return (
    <div className="decision-summary">
      <div className="decision-summary__head">
        <DecisionChip decision={decision} />
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
      <p className="cell-note">
        {decision.decidedByDisplayName ?? 'Someone'}, {formatDateTime(decision.decidedAt)}
      </p>
    </div>
  );
}

export function DecisionHistory({ line }: { line: InvoiceReviewLine }) {
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
              {past.note ? `. ${past.note}` : ''} ({past.decidedByDisplayName}, {formatDateTime(past.decidedAt)})
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

function cents(value: number): number {
  return Math.round(value * 100);
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
  mode: 'approved_in_part' | 'rejected' | 'note';
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

  const requestedCents = cents(Number(line.amount));
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
