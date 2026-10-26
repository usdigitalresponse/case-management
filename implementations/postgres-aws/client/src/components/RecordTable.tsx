import { Fragment, type ReactNode } from 'react';
import { Table } from '@trussworks/react-uswds';

// The shared table: a bordered card of rows, or a message when empty.
export interface RecordTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  // A share of the table's width, such as '20%'. When any column sets one,
  // the table keeps fixed widths, so tables repeated on a page (one per
  // section) line up column for column.
  width?: string;
  align?: 'left' | 'right';
  // Shown to screen readers only, for an unlabelled column such as a link.
  hiddenHeader?: boolean;
  // Render the cell as a row header (the row's name).
  rowHeader?: boolean;
  className?: string | ((row: T) => string | undefined);
}

export function RecordTable<T>({
  rows,
  columns,
  rowKey,
  rowClassName,
  rowDetail,
  emptyMessage = 'None.',
  label,
  className,
}: {
  rows: T[];
  columns: RecordTableColumn<T>[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  // A full-width row under a row, such as an open form for it.
  rowDetail?: (row: T) => ReactNode;
  emptyMessage?: string;
  // Names the table for screen readers when a page has several.
  label?: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className="empty-note">{emptyMessage}</p>;
  }
  const fixed = columns.some((column) => column.width);
  const cellClass = (column: RecordTableColumn<T>, row?: T) =>
    [
      column.align === 'right' ? 'amount' : '',
      typeof column.className === 'function' ? (row ? column.className(row) : '') : (column.className ?? ''),
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="data-card">
      <Table bordered fullWidth className={[fixed ? 'fixed-columns' : '', className ?? ''].join(' ').trim() || undefined} aria-label={label}>
        {fixed && (
          <colgroup>
            {columns.map((column) => (
              <col key={column.header} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.header} className={column.align === 'right' ? 'amount' : undefined}>
                {column.hiddenHeader ? <span className="usa-sr-only">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detail = rowDetail?.(row);
            return (
              <Fragment key={rowKey(row)}>
                <tr className={rowClassName?.(row)}>
                  {columns.map((column) =>
                    column.rowHeader ? (
                      <th scope="row" key={column.header} className={cellClass(column, row)}>
                        {column.render(row)}
                      </th>
                    ) : (
                      <td key={column.header} className={cellClass(column, row)}>
                        {column.render(row)}
                      </td>
                    ),
                  )}
                </tr>
                {detail && (
                  <tr className="detail-row">
                    <td colSpan={columns.length}>{detail}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
