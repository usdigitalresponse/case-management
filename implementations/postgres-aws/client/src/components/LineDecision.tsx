import type { InvoiceReviewLine, PortalInvoiceLine } from '../api/client';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { StatusPill } from './StatusPill';

// Portal lines carry no reviewer name, so none is shown there.
export function LineDecision({ line }: { line: PortalInvoiceLine | InvoiceReviewLine }) {
  if (!line.decisionOutcomeCode) {
    return <span className="invoice-line-decided-by">Not reviewed yet</span>;
  }
  const reviewer = 'decidedByDisplayName' in line ? line.decidedByDisplayName : undefined;
  return (
    <div className="invoice-line-decision">
      <StatusPill code={line.decisionOutcomeCode} label={line.decisionOutcomeDisplayName} />
      {line.decisionApprovedAmount && <span>{formatMoney(line.decisionApprovedAmount)} approved</span>}
      {line.decisionReason && <span>{line.decisionReason}</span>}
      {reviewer !== undefined && (
        <span className="invoice-line-decided-by">
          {reviewer ?? 'Unknown'}
          {line.decidedAt && `, ${formatDateTime(line.decidedAt)}`}
        </span>
      )}
    </div>
  );
}
