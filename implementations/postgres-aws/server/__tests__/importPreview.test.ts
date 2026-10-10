import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewFile } from '../src/imports/preview';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');
const sample = (file: string) => readFileSync(join(SAMPLES_DIR, file));

describe('import preview', () => {
  it('returns text, spreadsheet rows, or a PDF marker', async () => {
    const text = await previewFile('text/plain', sample('ledes-1998b-basic.txt'));
    expect(text).toMatchObject({ kind: 'text', truncated: false });
    expect(text.kind === 'text' && text.text.startsWith('LEDES1998B[]')).toBe(true);

    const rows = await previewFile('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sample('template-basic.xlsx'));
    expect(rows.kind === 'rows' && rows.rows[0]?.[0]).toBe('invoice_number');
    expect(rows.kind === 'rows' && rows.rows).toHaveLength(4);

    expect(await previewFile('application/pdf', sample('pdf-itemized.pdf'))).toEqual({ kind: 'pdf' });
  });

  it('caps long text', async () => {
    const preview = await previewFile('text/csv', Buffer.from('a'.repeat(250_000)));
    expect(preview).toMatchObject({ kind: 'text', truncated: true });
    expect(preview.kind === 'text' && preview.text.length).toBe(200_000);
  });
});
