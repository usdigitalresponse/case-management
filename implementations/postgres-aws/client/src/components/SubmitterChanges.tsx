// What a submitter changed from their file before sending (E9), for the
// review page: a marker and the value read on changed lines, and the lines
// they removed, in view but needing no decision.
import type { FileLine, FileSource, InvoiceLineType, InvoiceReviewLine } from '../api/client';
import { changedFields, formatQuantity, readLineType, type LineValues } from '../fileChanges';
import { formatDate } from '../formatDateTime';
import { formatMoney, formatRate } from '../formatMoney';
import { isMileage } from '../invoiceLineDisplay';

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

export function fileChangesFor(source: FileSource | null, lines: InvoiceReviewLine[]) {
  const reads = new Map((source?.lines ?? []).map((read) => [read.location, read]));
  const readOf = (line: InvoiceReviewLine): FileLine | undefined => (line.sourceLocation ? reads.get(line.sourceLocation) : undefined);
  const fieldsOf = (line: InvoiceReviewLine) => {
    const read = readOf(line);
    return read ? changedFields(read, valuesOf(line)) : [];
  };
  const removed = (source?.lines ?? []).filter((read) => !lines.some((line) => line.sourceLocation === read.location));
  const added = source ? lines.filter((line) => !readOf(line)) : [];
  return { readOf, fieldsOf, removed, added };
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
        <span className="chip chip--info">Added by {who}</span>
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
      <span className="chip chip--info">Changed by {who}</span>
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

export function wasQuantity(line: InvoiceReviewLine, read: FileLine | undefined, fields: string[]): string | null {
  return read && fields.includes('quantity') ? String(read.quantity ?? 0) : null;
}

export function wasAmount(line: InvoiceReviewLine, read: FileLine | undefined, fields: string[]): string | null {
  return read && fields.length > 0 && read.amount !== null && Math.abs(read.amount - Number(line.amount)) >= 0.005 ? formatMoney(read.amount) : null;
}

export function RemovedLines({ removed, who }: { removed: FileLine[]; who: string }) {
  if (removed.length === 0) {
    return null;
  }
  return (
    <div className="data-card removed-lines">
      <table className="usa-table usa-table--borderless">
        <caption>Removed by {who} before sending</caption>
        <tbody>
          {removed.map((read) => {
            const lineType = readLineType(read);
            return (
              <tr key={read.location}>
                <td>{read.serviceDate ? formatDate(read.serviceDate) : '—'}</td>
                <td>
                  <s>{read.description ?? '—'}</s>
                  <span className="chip chip--neutral">Removed by {who}</span>
                </td>
                <td className="amount">{formatQuantity(lineType, read.quantity)}</td>
                <td className="amount">{read.unitRate !== null ? formatRate(read.unitRate) : ''}</td>
                <td className="amount">
                  <s>{formatMoney(read.amount)}</s>
                </td>
                <td className="muted">Not on the invoice. Nothing to decide.</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
