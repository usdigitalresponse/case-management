import { afterEach, describe, expect, it } from 'vitest';
import { documentExtractor, EXTRACTORS } from '../src/imports/extractors';
import PDFDocument from 'pdfkit';
import { extractFromTextLayer, parseDate, parseMoney, textLooksGarbled } from '../src/imports/extractors/textLayer';
import { ConfigurationError } from '../src/errors';

describe('extractor selection', () => {
  afterEach(() => {
    delete EXTRACTORS['outside-test'];
  });

  it('defaults to the in-app text layer', () => {
    expect(documentExtractor(undefined, true).id).toBe('pdf-text-layer');
  });

  it('refuses unknown extractors, and outside-boundary ones in production', () => {
    expect(() => documentExtractor('nope', false)).toThrow(ConfigurationError);
    EXTRACTORS['outside-test'] = { id: 'outside-test', version: '0', inBoundary: false, extract: async () => ({ lines: [] }) };
    expect(documentExtractor('outside-test', false).id).toBe('outside-test');
    expect(() => documentExtractor('outside-test', true)).toThrow(/outside the processing boundary/);
  });
});

// Columns at fixed positions, one table per entry, each followed by its
// closing line; a new page where asked.
function tablesPdf(tables: Array<{ headings: string[]; rows: string[][]; closing: string; newPage?: boolean }>): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(10);
  let y = 72;
  for (const table of tables) {
    if (table.newPage) {
      doc.addPage();
      y = 72;
    }
    for (const cells of [table.headings, ...table.rows]) {
      cells.forEach((text, column) => doc.text(text, 48 + column * 110, y, { width: 100, lineBreak: false }));
      y += 18;
    }
    doc.text(table.closing, 48, y, { lineBreak: false });
    y += 36;
  }
  doc.end();
  return done;
}

describe('amount due', () => {
  const time = { headings: ['Date', 'Description', 'Hours', 'Rate', 'Amount'], rows: [['01/05/2026', 'Review', '2.00', '$150.00', '$300.00']] };
  const expenses = { headings: ['Date', 'Description', 'Amount'], rows: [['01/06/2026', 'Filing fee', '$45.00']] };

  it('keeps reading tables on the same page after a total due for part of the invoice', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([
        { ...time, closing: 'Total due for services: $300.00' },
        { ...expenses, closing: 'Balance due: $345.00' },
      ]),
    );
    expect(parsed.lines.map((line) => line.amount)).toEqual([300, 45]);
    expect(parsed.statedTotal).toBe(345);
  });

  it('stops at a table on a later page, such as an attached receipt', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([
        { ...time, closing: 'Balance due: $300.00' },
        { headings: ['Item', 'Qty', 'Price', 'Amount'], rows: [['Folders', '2', '$3.99', '$7.98']], closing: 'Total $7.98', newPage: true },
      ]),
    );
    expect(parsed.lines.map((line) => line.amount)).toEqual([300]);
    expect(parsed.statedTotal).toBe(300);
  });
});

describe('text-layer value parsing', () => {
  it('reads common date formats and rejects impossible dates', () => {
    expect(parseDate('01/05/2026')).toBe('2026-01-05');
    expect(parseDate('1/5/26')).toBe('2026-01-05');
    expect(parseDate('2026-01-05')).toBe('2026-01-05');
    expect(parseDate('01-05-2026')).toBe('2026-01-05');
    expect(parseDate('01-05/2026')).toBeUndefined();
    expect(parseDate('Jan. 5, 2026')).toBe('2026-01-05');
    expect(parseDate('February 30, 2026')).toBeUndefined();
    expect(parseDate('13/01/2026')).toBeUndefined();
  });

  it('treats a text layer of mostly unmapped characters as unusable', () => {
    expect(textLooksGarbled('Invoice No: 12 · Total $1,013.90 – café')).toBe(false);
    expect(textLooksGarbled('\u0003\u0011\u0012 $10.00 ��')).toBe(true);
    expect(textLooksGarbled('')).toBe(false);
  });

  it('reads the last amount in text, including thousands separators and credits', () => {
    expect(parseMoney('$1,013.90')).toBe(1013.9);
    expect(parseMoney('Total Due: $1,013.90')).toBe(1013.9);
    expect(parseMoney('($45.00)')).toBe(-45);
    expect(parseMoney('no amount')).toBeUndefined();
  });
});
