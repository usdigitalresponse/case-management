// Possible double billing (server/src/billing/billingOverlaps.ts); warns, never refuses.
import { Link as RouterLink } from 'react-router';
import type { BillingOverlap } from '../api/invoiceReview';
import { formatDate, formatDay, formatPeriod } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { Notice } from './ui/Notice';

function quantity(line: BillingOverlap['lines'][number]): string {
  if (line.quantity === null) return '—';
  return line.lineTypeCode === 'time' ? `${Number(line.quantity)} h` : String(Number(line.quantity));
}

export function BillingOverlaps({
  overlaps,
  lineNumbers,
  invoicePath,
  submitter = false,
}: {
  overlaps: BillingOverlap[];
  // Each of this invoice's lines by the number its table shows.
  lineNumbers: Map<string, number>;
  invoicePath: (invoiceId: string) => string;
  submitter?: boolean;
}) {
  if (overlaps.length === 0) return null;
  const twins = (ids: string[]) =>
    ids.flatMap((id) => lineNumbers.get(id) ?? []).sort((a, b) => a - b);
  return (
    <Notice tone="warning" heading={submitter ? 'Some of these dates are already billed' : 'Possible double billing'}>
      {submitter
        ? 'Invoices already sent cover some of the same dates. Check nothing here was billed on them before you send it.'
        : 'Other sent invoices cover some of the same dates for the same person. Check no work is billed twice.'}
      <ul className="billing-overlaps">
        {overlaps.map((overlap) => {
          const identical = overlap.lines.filter((line) => twins(line.sameAsLineIds).length > 0).length;
          return (
            <li key={overlap.invoiceId}>
              <strong>{overlap.sameCase ? 'This case' : `Case ${overlap.caseNumber ?? 'not given'}`}:</strong>{' '}
              <RouterLink to={invoicePath(overlap.invoiceId)} target="_blank" rel="noopener">
                {overlap.invoiceNumber || !overlap.submittedAt
                  ? `invoice ${overlap.invoiceNumber ?? 'without a number'}`
                  : `invoice sent ${formatDay(overlap.submittedAt)}`}
                <span className="usa-sr-only"> (opens a new tab)</span>
              </RouterLink>
              {overlap.professionalDisplayName && !submitter ? ` from ${overlap.professionalDisplayName}` : ''}, {formatPeriod(overlap.periodStart, overlap.periodEnd)},{' '}
              {formatMoney(overlap.submittedTotal)}, {overlap.statusDisplayName.toLowerCase()}
              {overlap.invoiceNumber && overlap.submittedAt ? `, sent ${formatDay(overlap.submittedAt)}` : ''}.{' '}
              {overlap.sameCase ? 'Its dates overlap this invoice’s.' : 'Time billed on the same days as this invoice.'}
              {overlap.lines.length === 0 ? (
                <> None of its lines fall on this invoice’s dates.</>
              ) : (
                <details className="billing-overlaps__details">
                  <summary>
                    {overlap.lines.length} {overlap.lines.length === 1 ? 'line' : 'lines'} on the same dates
                    {identical > 0 ? `, ${identical} with the same date, person and quantity as a line here` : ''}
                  </summary>
                  <div className="data-card">
                    <table className="usa-table usa-table--borderless">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Work done by</th>
                          <th scope="col">Description</th>
                          <th scope="col">Quantity</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Same as</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overlap.lines.map((line) => {
                          const same = twins(line.sameAsLineIds);
                          return (
                            <tr key={line.invoiceLineId}>
                              <td>{formatDate(line.serviceDate)}</td>
                              <td>{line.workerDisplayName ?? '—'}</td>
                              <td>{line.description ?? '—'}</td>
                              <td>{quantity(line)}</td>
                              <td>{formatMoney(line.amount)}</td>
                              <td>{same.length > 0 ? `Line ${same.join(', ')}` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}
