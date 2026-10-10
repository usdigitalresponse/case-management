// The invoice template, with one synthetic example row.
import writeXlsxFile from 'write-excel-file/node';
import { TEMPLATE_COLUMNS } from './parseSpreadsheet';

const EXAMPLE_ROW: Record<(typeof TEMPLATE_COLUMNS)[number], string | number> = {
  invoice_number: 'INV-0001',
  date: '2026-01-15',
  type: 'time',
  timekeeper: 'Example Timekeeper',
  description: 'Example: research and drafting',
  hours: 1.5,
  rate: 100,
  amount: 150,
  task_code: '',
  activity_code: '',
  expense_code: '',
};

export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function templateCsv(): string {
  const rows = [TEMPLATE_COLUMNS as readonly string[], TEMPLATE_COLUMNS.map((column) => EXAMPLE_ROW[column])];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function templateXlsx(): Promise<Buffer> {
  return writeXlsxFile(
    [
      TEMPLATE_COLUMNS.map((column) => ({ value: column, fontWeight: 'bold' as const })),
      TEMPLATE_COLUMNS.map((column) => {
        const value = EXAMPLE_ROW[column];
        return typeof value === 'number' ? { value, type: Number } : { value };
      }),
    ],
    { sheet: 'Invoice', columns: TEMPLATE_COLUMNS.map(() => ({ width: 18 })) },
  ).toBuffer();
}
