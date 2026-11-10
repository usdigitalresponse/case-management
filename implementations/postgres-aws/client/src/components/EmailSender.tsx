import type { PortalInvoiceLine, QueuedInvoice } from '../api/client';
import { formatDate, formatPeriod, formatDay } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { lineDate, lineDescription, lineHours, lineType } from '../invoiceLineDisplay';

// A line to write about, numbered as on the page, with any questions asked about it.
export interface EmailedLine {
  line: PortalInvoiceLine;
  number: number | undefined;
  questions?: string[];
}

// "Line 3: Feb 2, 2026, Time, Research, 2.00 h, $300.00"
function lineDetails({ line, number }: EmailedLine): string {
  const hours = lineHours(line);
  const parts = [lineDate(line), lineType(line), lineDescription(line), hours === '—' ? null : hours, formatMoney(line.amount)];
  return `Line ${number ?? ''}: ${parts.filter(Boolean).join(', ')}`;
}

// Kept to what the sender already knows; never staff-only comments.
export function senderMailto(email: string | null, invoice: QueuedInvoice, caseNumber: string | null, lines: EmailedLine[] = []): string {
  const when =
    invoice.periodStart || invoice.periodEnd
      ? formatPeriod(invoice.periodStart, invoice.periodEnd)
      : invoice.submittedAt
        ? `Sent ${formatDay(invoice.submittedAt)}`
        : invoice.receivedOn
          ? `Received ${formatDate(invoice.receivedOn)}`
          : null;
  const subject = [
    invoice.invoiceNumber ? `Your invoice ${invoice.invoiceNumber}` : 'Your invoice',
    caseNumber ? `Case ${caseNumber}` : null,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
  const body = [
    caseNumber ? `Case number: ${caseNumber}` : null,
    ...lines.map((emailed) => [lineDetails(emailed), ...(emailed.questions ?? []).map((question) => `Question: ${question}`)].join('\n')),
  ]
    .filter(Boolean)
    .join('\n\n');
  // Mail apps show URLSearchParams' + literally.
  const query = new URLSearchParams(body ? { subject, body: `${body}\n\n` } : { subject }).toString().replace(/\+/g, '%20');
  return `mailto:${email ?? ''}?${query}`;
}

const noAddress = 'No email on file. Add the address in your mail app.';

// Opens a draft in the staff member's own mail app; this system sends nothing.
export function EmailSender({
  email,
  invoice,
  caseNumber,
  lines,
}: {
  email: string | null;
  invoice: QueuedInvoice;
  caseNumber: string | null;
  lines?: EmailedLine[];
}) {
  return (
    <a className="btn btn--outline" href={senderMailto(email, invoice, caseNumber, lines)} title={email ? `Write to ${email}` : noAddress}>
      Email sender
    </a>
  );
}

// The same draft about one line, as a mail icon beside asking about it.
export function EmailAboutLine({
  email,
  invoice,
  caseNumber,
  line,
}: {
  email: string | null;
  invoice: QueuedInvoice;
  caseNumber: string | null;
  line: EmailedLine;
}) {
  const label = `Email the sender about line ${line.number ?? ''}`.trim();
  return (
    <a className="icon-link" href={senderMailto(email, invoice, caseNumber, [line])} aria-label={label} title={email ? label : noAddress}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    </a>
  );
}
