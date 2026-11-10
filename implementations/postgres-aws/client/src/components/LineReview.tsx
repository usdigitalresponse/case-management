import { useState, type FormEvent, type ReactNode } from 'react';
import type { CaseRate, DecisionReason, InvoiceReviewLine, LineDecision, LineDecisionInput, LineRateInput, RateType } from '../api/client';
import { formatDate, formatDateTime } from '../formatDateTime';
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
      {decision.timeLogOverride && (
        <p className="line-rate-differs">Approved although the time log doesn't support it: {decision.timeLogOverride}</p>
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
              {past.note ? `. ${past.note}` : ''}
              {past.timeLogOverride ? `. Approved although the time log doesn't support it: ${past.timeLogOverride}` : ''} ({[past.decidedByDisplayName, formatDateTime(past.decidedAt)].filter(Boolean).join(', ')})
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

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  hourly: 'hourly',
  travel: 'travel time',
  waiting: 'waiting time',
  mileage: 'mileage',
};

// Where else a changed rate may go: the matching lines on this invoice, or
// the case's default (model/rules.yaml set_case_rate).
export interface RateScope {
  personName: string;
  // Undecided lines by the same person at the same kind of rate, this one included.
  matching: InvoiceReviewLine[];
  hasCase: boolean;
  caseRates: CaseRate[];
  onApply: (input: LineRateInput) => void;
}

// The latest case rate for this person or kind, which a new one must follow.
export function latestCaseRate(caseRates: CaseRate[], line: InvoiceReviewLine, target: 'person' | 'kind'): CaseRate | null {
  const own = caseRates.filter(
    (row) =>
      row.rateType === line.rateType &&
      (target === 'person' ? row.professionalId === line.rateProfessionalId : row.professionalKindId === line.rateKindId),
  );
  return own.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1) ?? null;
}

// Approve part (corrected hours or rate, or the amount), approve at another
// rate, or reject. Cuts ask why; a lower rate asks with a short list under
// the rate. The note is seen by everyone who can see the invoice.
export function DecisionPanel({
  line,
  mode,
  reasons,
  initial,
  saving,
  error,
  onSubmit,
  onCancel,
  logBlocks = false,
  rateScope = null,
}: {
  line: InvoiceReviewLine;
  mode: PanelMode;
  reasons: DecisionReason[];
  initial: LineDecision | null;
  rateScope?: RateScope | null;
  // The time log flags it, and the setting asks why before approving its billed hours.
  logBlocks?: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (input: LineDecisionInput) => void;
  onCancel: () => void;
}) {
  const byHours = hasHours(line);
  const miles = isMileage(line);
  const [typedHours, setHours] = useState(initial?.approvedQuantity ?? line.quantity ?? '');
  const hours = mode === 'rate' ? (line.quantity ?? '') : typedHours;
  const adjusting = mode === 'approved_in_part' || mode === 'rate';
  const startRate = initial?.approvedRate ?? line.billedRate;
  const [rate, setRate] = useState(startRate ? Number(startRate).toFixed(miles ? 3 : 2) : '');
  const [amount, setAmount] = useState(initial?.outcomeCode === 'approved_in_part' ? (initial.approvedAmount ?? '') : '');
  const [picked, setReasonCode] = useState(initial?.reasonCode ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [override, setOverride] = useState(initial?.timeLogOverride ?? '');
  const [scope, setScope] = useState<'line' | 'matching' | 'case'>('line');
  const [target, setTarget] = useState<'person' | 'kind'>('person');
  const matching = rateScope?.matching ?? [];
  const [from, setFrom] = useState(matching.map((other) => other.serviceDate ?? '').sort()[0] || (line.serviceDate ?? ''));
  const [caseReason, setCaseReason] = useState('');
  const [toConfigured, setToConfigured] = useState(false);
  // Approving in part and rejecting have their own lists; a reason kept from
  // a decision on the other list doesn't carry over.
  const listMode = mode === 'rate' ? 'approved_in_part' : mode;
  const options = reasons.filter((reason) => reason.code === 'other' || reason.appliesTo === 'both' || reason.appliesTo === listMode);
  const reasonCode = options.some((reason) => reason.code === picked) ? picked : '';
  const caseReasons = reasons.filter((reason) => reason.code === 'other' || reason.appliesTo === 'case_rate');

  // Only the rate changed: it may also go to other lines or the case. A case
  // rate in force may also be returned to the configured rate.
  const hoursKept = adjusting && byHours && Number(hours) === Number(line.quantity);
  const rateOnly = hoursKept && Number(rate) > 0 && Number(rate) !== Number(line.billedRate);
  const canSetCase = Boolean(rateScope?.hasCase && line.rateProfessionalId && line.rateType && line.serviceDate);
  const fromCase = line.rateSource === 'case_person' || line.rateSource === 'case_kind';
  const offerScope = Boolean(
    mode === 'rate' && rateScope && line.rateType && hoursKept && ((rateOnly && (matching.length > 1 || canSetCase)) || (canSetCase && fromCase)),
  );
  const shownScope = offerScope ? scope : 'line';
  const latest = rateScope ? latestCaseRate(rateScope.caseRates, line, target) : null;
  const returning = shownScope === 'case' && toConfigured && latest?.rate != null;
  const caseInvalid =
    shownScope === 'case' &&
    (!caseReason || (caseReason === 'other' && !note.trim()) || !from || from > (line.serviceDate ?? '') || (!rateOnly && !returning));
  // The lines a rate beyond this one decides, as far as the page can tell.
  const scopeLines = shownScope === 'matching' ? matching : shownScope === 'case' ? matching.filter((other) => (other.serviceDate ?? '') >= from) : [];
  const scopeCents = scopeLines.reduce((sum, other) => sum + cents(Number(other.quantity) * Number(rate)), 0);
  const scopeRequestedCents = scopeLines.reduce((sum, other) => sum + cents(other.amount), 0);

  const requestedCents = cents(line.amount);
  const approvedCents = byHours ? cents(Number(hours) * Number(rate)) : cents(Number(amount));
  const validAmount = Number.isFinite(approvedCents) && approvedCents > 0 && approvedCents < requestedCents;
  // The same hours at a higher rate approve more than was asked: no reason
  // is needed, and sign-off sees the changed rate flagged.
  const raised =
    adjusting &&
    byHours &&
    Number(hours) === Number(line.quantity) &&
    Number(rate) > 0 &&
    Number(rate) !== Number(line.billedRate) &&
    approvedCents >= requestedCents;
  const rateValid = mode !== 'rate' || (Number(rate) > 0 && Number(rate) !== Number(line.billedRate));
  const needsReason = mode === 'rejected' || (adjusting && rateValid && !raised && shownScope === 'line');
  // Approving the billed hours, as billed or at another rate.
  const keepsHours = mode === 'time_log' || (adjusting && byHours && Number(hours) >= Number(line.quantity));
  const needsOverride = logBlocks && keepsHours;
  // Editing a note keeps the reason already given.
  const timeLogOverride = (needsOverride || mode === 'note') && override.trim() ? override.trim() : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'note') {
      // An approval at a changed rate, higher or lower, keeps it.
      const kept =
        initial?.outcomeCode === 'approved' && initial.approvedRate
          ? { approvedRate: Number(initial.approvedRate), approvedQuantity: initial.approvedQuantity ? Number(initial.approvedQuantity) : undefined }
          : {};
      onSubmit({ outcome: 'approved', ...kept, note: note.trim() || undefined, timeLogOverride });
      return;
    }
    if (mode === 'time_log') {
      onSubmit({ outcome: 'approved', note: note.trim() || undefined, timeLogOverride });
      return;
    }
    if (shownScope !== 'line' && rateScope) {
      rateScope.onApply({
        rate: returning ? null : Number(rate),
        scope: shownScope,
        ...(shownScope === 'case'
          ? { target, effectiveFrom: from, reasonCode: caseReason, basedOnCaseRateId: latest?.caseRateId ?? null }
          : {}),
        note: note.trim() || undefined,
        timeLogOverride,
      });
      return;
    }
    if (raised) {
      onSubmit({ outcome: 'approved', approvedRate: Number(rate), note: note.trim() || undefined, timeLogOverride });
      return;
    }
    const base = { reasonCode, note: note.trim() || undefined, timeLogOverride };
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
      : mode === 'time_log'
        ? `Approve the ${formatMoney(line.amount)} on this line although the time log doesn't support it`
        : mode === 'rejected'
        ? `Reject the ${formatMoney(line.amount)} on this line`
        : mode === 'rate'
          ? 'Approve at a different rate'
          : `Approve part of the ${formatMoney(line.amount)} on this line`;
  const unit = miles ? 'mile' : 'hour';
  const scopeResult = (
    <p className="decision-panel__result">
      {returning ? (
        <strong>
          {scopeLines.length} {scopeLines.length === 1 ? 'line' : 'lines'} approved at the configured rate
        </strong>
      ) : (
        <>
          <strong>
            You approve {formatMoney(scopeCents / 100)} on {scopeLines.length} {scopeLines.length === 1 ? 'line' : 'lines'}
          </strong>
          <span className="cell-note">
            {formatMoney(scopeRequestedCents / 100)} was requested. No reason needed; sign-off sees the changed rates flagged.
          </span>
        </>
      )}
    </p>
  );
  const reasonPicker = (
    <label className="decision-panel__rate-reason">
      Why a lower rate?
      <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
        <option value="">Choose a reason</option>
        {options.map((reason) => (
          <option key={reason.code} value={reason.code}>
            {reason.displayName}
          </option>
        ))}
      </select>
    </label>
  );
  const prefix = `line-${line.invoiceLineId}`;

  return (
    <form className={`decision-panel decision-panel--${mode}`} onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      <div className="decision-panel__grid">
        {mode === 'rate' && (
          <fieldset className="decision-panel__amount">
            <legend>The rate to approve it at, higher or lower</legend>
            <label>
              Rate per {unit}
              <input type="number" step={miles ? '0.001' : '0.01'} min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <span className="cell-note">
              Enter a rate other than the billed {formatRate(line.billedRate ?? '0')}
              {line.configuredRate !== null && Number(line.configuredRate) !== Number(line.billedRate)
                ? `. The default is ${formatRate(line.configuredRate)}.`
                : '.'}
            </span>
            {shownScope !== 'line' && scopeResult}
            {rateValid && shownScope === 'line' && (
              <p className="decision-panel__rate-result">
                You approve {formatMoney(approvedCents / 100)} from this line, {formatRate(rate)} per {unit}, instead of{' '}
                {formatRate(line.billedRate ?? '0')}. Sign-off sees the changed rate flagged.
              </p>
            )}
            {needsReason && reasonPicker}
          </fieldset>
        )}
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
              <p className="cell-note">Approve more than nothing and less than {formatMoney(line.amount)}.</p>
            )}
          </fieldset>
        )}
        {offerScope && rateScope && (
          <fieldset className="decision-panel__scope">
            <legend>{rateOnly ? `Use ${formatRate(rate)} for` : 'Change the rate for'}</legend>
            <label className="radio-row">
              <input type="radio" name={`${prefix}-scope`} checked={scope === 'line'} onChange={() => setScope('line')} />
              This line only
            </label>
            {rateOnly && matching.length > 1 && (
              <label className="radio-row">
                <input type="radio" name={`${prefix}-scope`} checked={scope === 'matching'} onChange={() => setScope('matching')} />
                The {matching.length} undecided {RATE_TYPE_LABELS[line.rateType!]} lines by {rateScope.personName} on this invoice
              </label>
            )}
            {canSetCase && (
              <label className="radio-row">
                <input type="radio" name={`${prefix}-scope`} checked={scope === 'case'} onChange={() => setScope('case')} />
                The case's default {RATE_TYPE_LABELS[line.rateType!]} rate, and the lines it covers here
              </label>
            )}
            {shownScope === 'case' && (
              <div className="decision-panel__case-rate">
                <div className="inline-pair">
                  <label>
                    For
                    <select value={target} onChange={(e) => setTarget(e.target.value as 'person' | 'kind')}>
                      <option value="person">{rateScope.personName}</option>
                      {line.rateKindId && <option value="kind">Every {line.rateKindDisplayName ?? 'person of their kind'} on this case</option>}
                    </select>
                  </label>
                  <label>
                    From work on
                    <input type="date" value={from} max={line.serviceDate ?? undefined} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                </div>
                {latest && (
                  <p className="cell-note">
                    Now {latest.rate === null ? 'the configured rate' : formatRate(latest.rate)} from {formatDate(latest.effectiveFrom)}, set by{' '}
                    {latest.recordedByDisplayName}.
                  </p>
                )}
                {latest?.rate != null && (
                  <label className="checkbox-row">
                    <input type="checkbox" checked={toConfigured} onChange={(e) => setToConfigured(e.target.checked)} />
                    Return to the configured rate instead
                  </label>
                )}
                <fieldset>
                  <legend>Why are you setting it?</legend>
                  {caseReasons.map((reason) => (
                    <label key={reason.code} className="radio-row">
                      <input
                        type="radio"
                        name={`${prefix}-case-reason`}
                        value={reason.code}
                        checked={caseReason === reason.code}
                        onChange={() => setCaseReason(reason.code)}
                      />
                      {reason.displayName}
                    </label>
                  ))}
                </fieldset>
                <p className="cell-note">Invoices already sent keep their defaults; open ones on this case are flagged.</p>
              </div>
            )}
          </fieldset>
        )}
        {needsReason && mode !== 'rate' && (
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
        {needsOverride && (
          <label className="decision-panel__note">
            Why approve its {miles ? 'miles' : 'hours'} although the time log doesn't support them?
            <textarea rows={3} value={override} onChange={(e) => setOverride(e.target.value)} />
            <span className="cell-note">Only staff see this. Sign-off sees it with the line.</span>
          </label>
        )}
        <label className="decision-panel__note">
          Note for the record{reasonCode === 'other' || (shownScope === 'case' && caseReason === 'other') ? '' : ' (optional)'}
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
            (adjusting && !validAmount && !raised && shownScope === 'line') ||
            !rateValid ||
            caseInvalid ||
            (reasonCode === 'other' && !note.trim()) ||
            (needsOverride && !override.trim())
          }
        >
          {mode === 'note'
            ? 'Save note'
            : mode === 'time_log'
              ? `Approve ${formatMoney(line.amount)}`
              : mode === 'rejected'
              ? 'Reject line'
              : returning
                ? 'Return to the configured rate and approve'
                : shownScope === 'case'
                ? 'Set the case rate and approve'
                : shownScope === 'matching'
                  ? `Approve ${matching.length} lines at ${formatRate(rate)}`
                  : mode === 'rate'
                    ? 'Approve at this rate'
                    : validAmount || raised
                      ? `Approve ${formatMoney(approvedCents / 100)}`
                      : 'Approve part'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
        {!rateValid && <span className="cell-note">Enter a different rate first.</span>}
        {needsReason && !reasonCode && <span className="cell-note">Choose a reason first.</span>}
        {!(needsReason && !reasonCode) && needsOverride && !override.trim() && <span className="cell-note">Say why first.</span>}
      </div>
    </form>
  );
}

export type PanelMode = 'approved_in_part' | 'rate' | 'rejected' | 'note' | 'time_log';

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
  approveBlocked = null,
}: {
  line: InvoiceReviewLine;
  decision: LineDecision | null;
  inReview: boolean;
  canDecide: boolean;
  changing: boolean;
  // Changed and not saved yet: saving undoes its decision, so it is decided again.
  edited?: boolean;
  // Why approving it as billed needs a reason, if it does.
  approveBlocked?: string | null;
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
        <div className="decision-bar" role="group" aria-label="Decide this line">
          <button
            type="button"
            className={openPanel === 'time_log' ? 'is-active' : undefined}
            disabled={saving}
            aria-expanded={approveBlocked ? openPanel === 'time_log' : undefined}
            onClick={approveBlocked ? () => toggle('time_log') : onApprove}
          >
            Approve
          </button>
          <button
            type="button"
            className={openPanel === 'approved_in_part' ? 'is-active' : undefined}
            aria-expanded={openPanel === 'approved_in_part'}
            onClick={() => toggle('approved_in_part')}
          >
            Part
          </button>
          {hasHours(line) && (
            <button
              type="button"
              className={openPanel === 'rate' ? 'is-active' : undefined}
              aria-expanded={openPanel === 'rate'}
              onClick={() => toggle('rate')}
            >
              Rate
            </button>
          )}
          <button
            type="button"
            className={`decision-bar__reject${openPanel === 'rejected' ? ' is-active' : ''}`}
            aria-expanded={openPanel === 'rejected'}
            onClick={() => toggle('rejected')}
          >
            Reject
          </button>
        </div>
        {openPanel && (
          <span className="cell-note decision-hint">
            {openPanel === 'rate' ? 'Give a rate below' : openPanel === 'approved_in_part' ? 'Correct it below' : 'Give a reason below'}
          </span>
        )}
        {approveBlocked && !openPanel && <span className="cell-note line-rate-differs">{approveBlocked}</span>}
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
              onClick={() =>
                onPanel(
                  decision.outcomeCode === 'approved'
                    ? 'note'
                    : rateChanged(line, decision) && Number(decision.approvedQuantity) === Number(line.quantity)
                      ? 'rate'
                      : 'approved_in_part',
                )
              }
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
    timeLogOverride: previous.timeLogOverride ?? undefined,
  };
}
