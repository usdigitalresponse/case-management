import { Link } from 'react-router';
import type { CaseRate } from '../api/client';
import { formatDate, formatDateTime } from '../formatDateTime';
import { formatRate } from '../formatMoney';
import { reviewPath } from '../staffPaths';
import { RATE_TYPE_LABELS } from './lineReview/lineRates';
import { Notice } from './ui/Notice';
import { RecordTable } from './RecordTable';

const forWhom = (row: CaseRate) => row.professionalDisplayName ?? `Every ${row.kindDisplayName ?? 'person of that kind'}`;
const rateOf = (rate: string | null) => (rate === null ? 'The configured rate' : formatRate(rate));

// A case's rates as reviewers set them, oldest work first. Read-only.
export function CaseRateTable({ rows, label, showInvoice = true }: { rows: CaseRate[]; label: string; showInvoice?: boolean }) {
  return (
    <RecordTable
      label={label}
      rows={rows}
      rowKey={(row) => row.caseRateId}
      rowClassName={(row) => (row.inForce ? undefined : 'is-retired')}
      emptyMessage="No case rates. Its invoices use the configured rates."
      columns={[
        {
          header: 'For',
          rowHeader: true,
          render: (row) => (
            <>
              {forWhom(row)}
              <span className="cell-note">{RATE_TYPE_LABELS[row.rateType]}</span>
            </>
          ),
        },
        {
          header: 'Rate',
          render: (row) => (
            <>
              <strong>{rateOf(row.rate)}</strong>
              {row.replacedRate !== null && <span className="cell-note">Was {formatRate(row.replacedRate)}</span>}
              {row.inForce && <span className="cell-note">In force now</span>}
            </>
          ),
        },
        { header: 'From work on', render: (row) => formatDate(row.effectiveFrom) },
        {
          header: 'Why',
          render: (row) => (
            <>
              {[row.reasonDisplayName, row.note].filter(Boolean).join('. ')}
              {row.correctsCaseRateId && <span className="cell-note">Replaces an earlier rate from the same date</span>}
            </>
          ),
        },
        {
          header: 'Set by',
          render: (row) => (
            <>
              {row.recordedByDisplayName}
              <span className="cell-note">{formatDateTime(row.recordedAt)}</span>
              {showInvoice && (
                <Link className="cell-note" to={reviewPath(row.invoiceId)}>
                  {row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : 'The invoice'}
                </Link>
              )}
            </>
          ),
        },
      ]}
    />
  );
}

// On the review page: the case's rates in force, any set on this invoice for
// the second person to check, and any set since it was sent.
export function InvoiceCaseRates({
  invoiceId,
  caseRates,
  changedSinceSent,
  awaitingSignOff,
}: {
  invoiceId: string;
  caseRates: CaseRate[];
  changedSinceSent: string[];
  awaitingSignOff: boolean;
}) {
  const setHere = caseRates.filter((row) => row.invoiceId === invoiceId);
  const changed = caseRates.filter((row) => changedSinceSent.includes(row.caseRateId));
  const inForce = caseRates.filter((row) => row.inForce);
  if (caseRates.length === 0) {
    return null;
  }
  return (
    <>
      {changed.length > 0 && (
        <Notice tone="warning" heading="The case's default rate changed after this invoice was sent.">
          <ul>
            {changed.map((row) => (
              <li key={row.caseRateId}>
                {forWhom(row)}, {RATE_TYPE_LABELS[row.rateType]}: {rateOf(row.rate)} from {formatDate(row.effectiveFrom)}, set by{' '}
                {row.recordedByDisplayName} on {formatDateTime(row.recordedAt)}.
              </li>
            ))}
          </ul>
          Its lines keep the defaults they were sent with. Change a line's rate if it should follow.
        </Notice>
      )}
      {awaitingSignOff && setHere.length > 0 && (
        <Notice tone="warning" heading="The reviewer set the case's default rate on this invoice. Check it before signing off.">
          <ul>
            {setHere.map((row) => (
              <li key={row.caseRateId}>
                {forWhom(row)}, {RATE_TYPE_LABELS[row.rateType]}: {rateOf(row.rate)}
                {row.replacedRate !== null ? `, was ${formatRate(row.replacedRate)}` : ''}, from {formatDate(row.effectiveFrom)}. Set by{' '}
                {row.recordedByDisplayName}: {[row.reasonDisplayName, row.note].filter(Boolean).join('. ')}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <details className="case-rates">
        <summary>
          Case rates in force: {inForce.length === 0 ? 'none' : inForce.map((row) => `${forWhom(row)} ${rateOf(row.rate)}`).join(', ')}
        </summary>
        <CaseRateTable rows={caseRates} label="Case rates" />
      </details>
    </>
  );
}
