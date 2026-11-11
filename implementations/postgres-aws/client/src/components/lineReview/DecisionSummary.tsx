import { useState } from 'react';
import type { InvoiceReviewLine, LineDecision } from '../../api/client';
import { formatDateTime } from '../../formatDateTime';
import { formatMoney, formatRate } from '../../formatMoney';
import { StatusPill } from '../StatusPill';

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
