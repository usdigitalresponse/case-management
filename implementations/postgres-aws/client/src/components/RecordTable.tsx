import type { ReactNode } from 'react';
import { Table } from '@trussworks/react-uswds';

// Shared "empty vs. bordered table" shape — CaseDetail previously repeated
// this three times (participants, lifecycle events, identifiers) with only
// the columns/row cells differing.
export interface RecordTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

export function RecordTable<T>({
  rows,
  columns,
  rowKey,
  emptyMessage = 'None.',
}: {
  rows: T[];
  columns: RecordTableColumn<T>[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p>{emptyMessage}</p>;
  }

  return (
    <div className="data-card">
      <Table bordered fullWidth>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.header}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.header}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
