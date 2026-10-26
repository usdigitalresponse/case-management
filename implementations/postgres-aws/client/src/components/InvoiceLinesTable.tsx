import type { ReactNode } from 'react';
import type { PortalInvoiceLine } from '../api/client';
import { RecordTable } from './RecordTable';
import { formatMoney } from '../formatMoney';
import { isMileage, lineDate, lineDescription, lineHours, lineRate, lineTimekeeper, lineType } from '../invoiceLineDisplay';

// An invoice's lines as reviewers and submitters both see them, with an
// optional decision column and a panel under a line.
export function InvoiceLinesTable<L extends PortalInvoiceLine>({
  lines,
  decisionHeader,
  decision,
  rowClassName,
  rowDetail,
}: {
  lines: L[];
  decisionHeader?: string;
  decision?: (line: L) => ReactNode;
  rowClassName?: (line: L) => string | undefined;
  rowDetail?: (line: L) => ReactNode;
}) {
  return (
    <RecordTable
      className="review-table"
      rows={lines}
      rowKey={(line) => line.invoiceLineId}
      emptyMessage="This invoice has no items."
      rowClassName={rowClassName}
      rowDetail={rowDetail}
      columns={[
        { header: 'Date', render: (line) => lineDate(line) },
        {
          header: 'What was done',
          render: (line) => (
            <>
              {lineDescription(line)}
              <span className="cell-note">
                {lineType(line)} · {lineTimekeeper(line)}
                {isMileage(line) && line.tripOrigin && line.tripDestination ? ` · ${line.tripOrigin} → ${line.tripDestination}` : ''}
              </span>
            </>
          ),
        },
        { header: lines.some(isMileage) ? 'Hours / miles' : 'Hours', align: 'right', render: (line) => lineHours(line) },
        { header: 'Rate', align: 'right', render: (line) => lineRate(line) },
        { header: 'Requested', align: 'right', render: (line) => <strong>{formatMoney(line.amount)}</strong> },
        ...(decision ? [{ header: decisionHeader ?? 'Decision', className: 'decision-cell', render: decision }] : []),
      ]}
    />
  );
}

// Rejected lines are dimmed; a line with an open panel is highlighted.
export function lineRowClass(outcomeCode: string | undefined, open: boolean): string | undefined {
  return outcomeCode === 'rejected' ? 'is-rejected' : open ? 'is-open' : undefined;
}
