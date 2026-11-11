// On the review page: what the submitter changed from their file, and the
// lines they removed, which need no decision.
import { Fragment } from 'react';
import type { FileLine, FileSource, InvoiceLineType, InvoiceReviewLine } from '../api/client';
import { changedFields, readLineType, tracksSource, type LineValues } from '../fileChanges';
import { formatQuantity } from '../invoiceLineDisplay';
import { formatDate } from '../formatDateTime';
import { formatMoney, formatRate } from '../formatMoney';
import { isMileage } from '../invoiceLineDisplay';
import { Tag } from './ui/Tag';

function lineTypeOf(line: InvoiceReviewLine): InvoiceLineType {
  return isMileage(line) ? 'mileage' : line.lineTypeCode === 'time' ? 'time' : line.lineTypeCode === 'expense' ? 'expense' : 'other';
}

function valuesOf(line: InvoiceReviewLine): LineValues {
  return {
    lineType: lineTypeOf(line),
    serviceDate: line.serviceDate,
    description: line.description,
    quantity: line.quantity === null ? null : Number(line.quantity),
    unitRate: line.unitRate === null ? null : Number(line.unitRate),
    amount: Number(line.amount),
  };
}

export function fileChangesFor(fileSource: FileSource | null, lines: InvoiceReviewLine[]) {
  const source = fileSource && tracksSource(lines.map((line) => line.sourceLocation)) ? fileSource : null;
  const reads = new Map((source?.lines ?? []).map((read) => [read.location, read]));
  const readOf = (line: InvoiceReviewLine): FileLine | undefined => (line.sourceLocation ? reads.get(line.sourceLocation) : undefined);
  const fieldsOf = (line: InvoiceReviewLine) => {
    const read = readOf(line);
    return read ? changedFields(read, valuesOf(line)) : [];
  };
  const removed = (source?.lines ?? []).filter((read) => !lines.some((line) => line.sourceLocation === read.location));
  const added = source ? lines.filter((line) => !readOf(line)) : [];
  return { tracking: source !== null, readOf, fieldsOf, removed, added };
}

// The marker under a changed or added line's description.
export function ChangeNote({
  line,
  read,
  changed,
  who,
  onShow,
}: {
  line: InvoiceReviewLine;
  read: FileLine | undefined;
  changed: boolean;
  who: string;
  onShow?: () => void;
}) {
  if (!read) {
    return (
      <span className="change-note">
        <Tag tone="info">Added by {who}</Tag>
      </span>
    );
  }
  if (!changed) {
    return onShow ? (
      <button type="button" className="link-button change-note__show" onClick={onShow}>
        Show on the file
      </button>
    ) : null;
  }
  const lineType = lineTypeOf(line);
  return (
    <span className="change-note">
      <Tag tone="info">Changed by {who}</Tag>
      <span className="cell-note change-note__text">
        The file says {formatQuantity(lineType, read.quantity)}
        {read.amount !== null ? `, ${formatMoney(read.amount)}` : ''}
        {read.description && read.description !== line.description ? `, "${read.description}"` : ''}
        {read.serviceDate && read.serviceDate !== line.serviceDate ? `, on ${formatDate(read.serviceDate)}` : ''}.{' '}
        {onShow && (
          <button type="button" className="link-button" onClick={onShow}>
            Show on the file
          </button>
        )}
      </span>
    </span>
  );
}

// "was 84" under a changed quantity or amount.
export function WasNote({ value }: { value: string | null }) {
  return value === null ? null : <span className="cell-note">was {value}</span>;
}

export function wasQuantity(read: FileLine | undefined, fields: string[]): string | null {
  return read && fields.includes('quantity') ? String(read.quantity ?? 0) : null;
}

export function wasAmount(line: InvoiceReviewLine, read: FileLine | undefined, fields: string[]): string | null {
  return read && fields.length > 0 && read.amount !== null && Math.abs(read.amount - Number(line.amount)) >= 0.005 ? formatMoney(read.amount) : null;
}

export function RemovedLines({ removed, who, when = 'before sending' }: { removed: FileLine[]; who: string; when?: string }) {
  if (removed.length === 0) {
    return null;
  }
  return (
    <div className="card data-card removed-lines">
      <table className="usa-table usa-table--borderless">
        <caption>Removed by {who} {when}</caption>
        <tbody>
          {removed.map((read) => {
            const lineType = readLineType(read);
            // What was done has the full width under the figures, as on the lines above.
            return (
              <Fragment key={read.location}>
                <tr className="has-note">
                  <td>{read.serviceDate ? formatDate(read.serviceDate) : '—'}</td>
                  <td>
                    <Tag tone="neutral">Removed by {who}</Tag>
                  </td>
                  <td className="amount">{formatQuantity(lineType, read.quantity)}</td>
                  <td className="amount">{read.unitRate !== null ? formatRate(read.unitRate) : ''}</td>
                  <td className="amount">
                    <s>{formatMoney(read.amount)}</s>
                  </td>
                  <td className="muted">Not on the invoice. Nothing to decide.</td>
                </tr>
                <tr className="note-row">
                  <td colSpan={6}>
                    <s>{read.description ?? '—'}</s>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
