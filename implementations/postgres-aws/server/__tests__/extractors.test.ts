import { afterEach, describe, expect, it } from 'vitest';
import { documentExtractor, EXTRACTORS } from '../src/imports/extractors';
import PDFDocument from 'pdfkit';
import { extractFromTextLayer, legible, parseDate, parseMoney, reconcileFigures, textLooksGarbled } from '../src/imports/extractors/textLayer';
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

  it('does not take a page number line for an item', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([{ ...time, rows: [...time.rows, ['', 'Invoice 12 | Page', '', '', '1']], closing: 'Balance due: $300.00' }]),
    );
    expect(parsed.lines.map((line) => line.amount)).toEqual([300]);
  });

  it('takes the stated total from before the amount due, not from a later page', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([
        { ...time, closing: 'Balance due: $300.00' },
        { headings: ['Receipt'], rows: [['Folders']], closing: 'Total $7.98', newPage: true },
      ]),
    );
    expect(parsed.statedTotal).toBe(300);
  });
});

// Free text, one entry per line (an array is cells across the line); each
// inner array is a page.
function letterPdf(pages: Array<Array<string | string[]>>): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(10);
  pages.forEach((lines, page) => {
    if (page > 0) {
      doc.addPage();
    }
    lines.forEach((line, index) =>
      [line].flat().forEach((text, column) => doc.text(text, 48 + column * 150, 72 + index * 18, { lineBreak: false })),
    );
  });
  doc.end();
  return done;
}

describe('items written as sentences', () => {
  it('reads hours × rate sentences and numbered amounts, and stops at the total', async () => {
    const parsed = await extractFromTextLayer(
      await letterPdf([
        [
          'Dear reviewer,',
          'The following is billing for the work below.',
          '1. Review of records 3 hrs x $100.00 = $300.00',
          '2. Site visit and inspection',
          '2 hrs x $100.00 = $200.00',
          '3. Lodging, one night $ 15.00',
          'TOTAL $515.00',
        ],
        [['Date', 'Description', 'Amount'], ['01/06/2026', 'Attached receipt', '$9.99'], 'Total $9.99'],
      ]),
    );
    expect(parsed.lines.map((line) => [line.quantity, line.unitRate, line.amount])).toEqual([
      [3, 100, 300],
      [2, 100, 200],
      [undefined, undefined, 15],
    ]);
    expect(parsed.lines.map((line) => line.lineType)).toEqual(['time', 'time', 'expense']);
    expect(parsed.lines[1]!.description).toBe('Site visit and inspection');
    expect(parsed.statedTotal).toBe(515);
  });

  it('still refuses a file with neither an item table nor item sentences', async () => {
    await expect(extractFromTextLayer(await letterPdf([['Dear reviewer,', '1. Our rates are attached $ 15.00']]))).rejects.toMatchObject({
      fieldErrors: { file: expect.stringContaining('No table of invoice items') },
    });
  });
});

describe('recognized figure repair', () => {
  const read = (quantity: string, unitRate: string, amount: string, confidence?: { quantity?: number; unitRate?: number }) => ({
    quantity: { text: quantity, confidence: confidence?.quantity },
    unitRate: { text: unitRate, confidence: confidence?.unitRate },
    amount: { text: amount },
  });

  it('leaves figures that multiply out, or that no single explanation fits', () => {
    expect(reconcileFigures(read('2', '150.00', '300.00')).repaired).toEqual([]);
    expect(reconcileFigures(read('2', '150.00', '350.00'))).toEqual({ figures: { quantity: 2, unitRate: 150, amount: 350 }, repaired: [] });
  });

  it('restores a decimal point recognition dropped', () => {
    expect(reconcileFigures(read('1.5', '200.00', '30000'))).toEqual({ figures: { quantity: 1.5, unitRate: 200, amount: 300 }, repaired: ['amount'] });
    expect(reconcileFigures(read('35', '100.00', '350.00'))).toEqual({ figures: { quantity: 3.5, unitRate: 100, amount: 350 }, repaired: ['quantity'] });
  });

  it('works out an unreadable or unsure figure from the other two', () => {
    expect(reconcileFigures(read('1.8', '100.00', 'pr')).figures.amount).toBe(180);
    expect(reconcileFigures(read('Th', '250.00', '250.00')).figures.quantity).toBe(1);
    expect(reconcileFigures(read('24', '100.00', '210.00', { quantity: 50 })).figures.quantity).toBe(2.1);
    expect(reconcileFigures(read('40', '$0/r25', '29.00', { unitRate: 38 })).figures.unitRate).toBe(0.725);
    // Read confidently, a mismatch is the invoice's own and stays.
    expect(reconcileFigures(read('24', '100.00', '210.00')).repaired).toEqual([]);
  });

  it('prefers numbers read among marks to working a figure out', () => {
    expect(reconcileFigures(read('1 1', '20.00', '2000')).figures).toEqual({ quantity: 1, unitRate: 20, amount: 20 });
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

  it('quotes unclear text only when it is mostly figures, without stray symbols', () => {
    expect(legible('37.0¥¥')).toBe('37.0');
    expect(legible('“42-40')).toBe('42-40');
    expect(legible('2.134 hrs')).toBe('2.134 hrs');
    expect(legible('it 1%')).toBeUndefined();
    expect(legible('so fs')).toBeUndefined();
  });

  it('reads points as thousands separators and prefers an amount with cents', () => {
    expect(parseMoney('$2.500.00')).toBe(2500);
    expect(parseMoney('TOTAL $12,345.00 7')).toBe(12345);
    expect(parseMoney('2200')).toBe(2200);
    expect(parseMoney('$0.725')).toBe(0.725);
  });
});
