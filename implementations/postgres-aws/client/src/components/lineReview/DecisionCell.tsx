import type { ReactNode } from 'react';
import type { InvoiceReviewLine, LineDecision } from '../../api/client';
import { DecisionHistory, DecisionSummary } from './DecisionSummary';
import { hasHours, rateChanged } from './lineRates';
import { PanelMode } from './DecisionPanel';

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
            aria-label="Approve part"
            onClick={() => toggle('approved_in_part')}
          >
            Part
          </button>
          {hasHours(line) && (
            <button
              type="button"
              className={openPanel === 'rate' ? 'is-active' : undefined}
              aria-expanded={openPanel === 'rate'}
              aria-label="Approve at a different rate"
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
