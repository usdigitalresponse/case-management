import type { PortalInvoiceLine, QueuedInvoice } from '../api/client';
import { formatDateTime, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { StatusPill } from './StatusPill';

// Shared by staff review and the portal invoice page.
export function InvoiceSummary({
  invoice,
  lines,
  showReviewProgress = false,
}: {
  invoice: QueuedInvoice;
  lines: PortalInvoiceLine[];
  showReviewProgress?: boolean;
}) {
  const submitted = isSubmittedStatus(invoice.statusCode);
  const approvedCents = lines.reduce((sum, line) => sum + Math.round(Number(line.decisionApprovedAmount ?? 0) * 100), 0);
  const decidedCount = lines.filter((line) => line.decisionOutcomeCode).length;
  const delegated = invoice.submittedByDisplayName && invoice.submittedByDisplayName !== invoice.professionalDisplayName;

  return (
    <dl className="fact-grid">
      <div className="fact">
        <dt>Status</dt>
        <dd><StatusPill code={invoice.statusCode} label={invoice.statusDisplayName} /></dd>
      </div>
      <div className="fact">
        <dt>Professional</dt>
        <dd>{invoice.professionalDisplayName ?? 'Unknown'}</dd>
      </div>
      {delegated && (
        <div className="fact">
          <dt>Submitted by</dt>
          <dd>{invoice.submittedByDisplayName}</dd>
        </div>
      )}
      {submitted && (
        <div className="fact">
          <dt>Submitted</dt>
          <dd>{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : '—'}</dd>
        </div>
      )}
      <div className="fact">
        <dt>Billing period</dt>
        <dd>{formatPeriod(invoice.periodStart, invoice.periodEnd)}</dd>
      </div>
      <div className="fact">
        <dt>{submitted ? 'Requested total' : 'Total'}</dt>
        <dd>{formatMoney(invoice.submittedTotal)}</dd>
      </div>
      {submitted && (
        <div className="fact">
          <dt>Approved so far</dt>
          <dd>{formatMoney(approvedCents / 100)}</dd>
        </div>
      )}
      {submitted && showReviewProgress && (
        <div className="fact">
          <dt>Items reviewed</dt>
          <dd>{decidedCount} of {lines.length}</dd>
        </div>
      )}
    </dl>
  );
}

export function isSubmittedStatus(statusCode: string): boolean {
  return !['draft', 'withdrawn'].includes(statusCode);
}

// Matches the export file name.
export function invoiceReference(invoiceId: string): string {
  return `Invoice ${invoiceId.slice(0, 8)}`;
}
