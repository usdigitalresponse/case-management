// The original shown beside import review: text or rows, capped. PDFs are
// drawn by the browser from the file itself.
import { readSheet } from 'read-excel-file/node';

export type ImportPreview =
  | { kind: 'pdf' }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'rows'; rows: string[][]; truncated: boolean };

const MAX_TEXT_CHARS = 200_000;
const MAX_ROWS = 500;

function cellText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value === null || value === undefined ? '' : String(value);
}

export async function previewFile(mediaType: string, bytes: Buffer): Promise<ImportPreview> {
  if (mediaType === 'application/pdf') {
    return { kind: 'pdf' };
  }
  if (mediaType.startsWith('text/')) {
    const text = bytes.toString('utf8');
    return { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
  }
  const rows = (await readSheet(bytes)) as unknown[][];
  return { kind: 'rows', rows: rows.slice(0, MAX_ROWS).map((row) => row.map(cellText)), truncated: rows.length > MAX_ROWS };
}
