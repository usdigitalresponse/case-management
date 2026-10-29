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

  it('only suggests the items of a table on a later page, such as an attached receipt', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([
        { ...time, closing: 'Balance due: $300.00' },
        { headings: ['Item', 'Qty', 'Price', 'Amount'], rows: [['Folders', '2', '$3.99', '$7.98']], closing: 'Total $7.98', newPage: true },
      ]),
    );
    expect(parsed.lines.map((line) => line.amount)).toEqual([300]);
    expect(parsed.statedTotal).toBe(300);
    expect(parsed.suggestedLines).toMatchObject([
      { location: 'page 2, attachment item 1', lineType: 'expense', description: 'Folders', quantity: 2, unitRate: 3.99, amount: 7.98 },
    ]);
    expect(parsed.warnings?.map((warning) => [warning.code, warning.location])).toEqual([['attachment_items', 'page 2']]);
  });

  it('notes an attachment matching an item as its backup, suggesting nothing', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([
        { ...expenses, closing: 'Balance due: $45.00' },
        { headings: ['Item', 'Qty', 'Price', 'Amount'], rows: [['Court filing', '1', '$40.00', '$40.00'], ['Card fee', '1', '$5.00', '$5.00']], closing: 'Total $45.00', newPage: true },
      ]),
    );
    expect(parsed.suggestedLines).toBeUndefined();
    expect(parsed.warnings).toEqual([
      { code: 'attachment_matches', location: 'page 1, row 1', message: 'Page 2 of the file shows the same amount (45.00), likely its receipt or backup.' },
    ]);
  });

  it('takes a receipt total within a dollar of an item for its backup, saying so', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([
        { ...expenses, closing: 'Balance due: $45.00' },
        { headings: ['Receipt'], rows: [['Filing, card fee $0.25']], closing: 'Total $44.98', newPage: true },
      ]),
    );
    expect(parsed.warnings?.map((warning) => [warning.code, warning.location])).toEqual([['attachment_matches', 'page 1, row 1']]);
    expect(parsed.warnings?.[0]?.message).toContain('close to this item’s 45.00');
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
    // An amount on a later page that no item explains is pointed out.
    expect(parsed.warnings?.map((warning) => [warning.code, warning.location])).toEqual([['attachment_amounts', 'page 2']]);
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

// Labels with underlined blanks; values sit a few points above the line (a
// flattened form) or in live form fields.
type Blank = { value: string; width?: number };

function fillInFormPdf(pages: Array<Array<Array<string | Blank>>>, { fields = false } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  if (fields) {
    doc.initForm();
  }
  doc.font('Helvetica').fontSize(10);
  let field = 0;
  pages.forEach((lines, page) => {
    if (page > 0) {
      doc.addPage();
    }
    lines.forEach((parts, index) => {
      const y = 72 + index * 24;
      let x = 36;
      for (const part of parts) {
        if (typeof part === 'string') {
          doc.text(part, x, y, { lineBreak: false });
          x += doc.widthOfString(part) + 3;
          continue;
        }
        const width = part.width ?? 36;
        doc.moveTo(x, y + 10).lineTo(x + width, y + 10).stroke();
        if (fields) {
          field += 1;
          doc.formText(`field${field}`, x, y - 4, width, 14, { value: part.value });
        } else if (part.value !== '') {
          doc.text(part.value, x + 2, y - 4, { lineBreak: false });
        }
        x += width + 3;
      }
    });
  });
  doc.end();
  return done;
}

describe('fill-in forms', () => {
  const form = (values: { total: string; attorney: [string, string, string]; mileage: [string, string, string]; postage: string }) => [
    [
      ['Request for Payment'],
      ['Invoice No:', { value: 'SYN-0042', width: 120 }],
      ['Invoice period:', { value: '03/01/2026', width: 70 }, 'to', { value: '03/31/2026', width: 70 }, 'Total Requested: $', { value: values.total, width: 60 }],
    ],
    [
      ['TIME (in tenths of an hour)'],
      [
        'Attorney:',
        { value: values.attorney[0] },
        'hrs.; $',
        { value: values.attorney[1] },
        '/hour = $',
        { value: values.attorney[2], width: 50 },
        'Attorney:',
        { value: '2' },
        'hrs.; $',
        { value: '175' },
        '/hour = $',
        { value: '350.00', width: 50 },
      ],
      ['Travel:', { value: '.4' }, 'hrs.; $', { value: '75' }, '/hour = $', { value: '30.00', width: 50 }, 'Travel:', { value: '' }, 'hrs.; $', { value: '' }, '/hour = $', { value: '0.00', width: 50 }],
      ['EXPENSES'],
      ['Mileage:', { value: values.mileage[0] }, 'miles; $', { value: values.mileage[1] }, '/mi. = $', { value: values.mileage[2], width: 50 }],
      [{ value: values.postage === '' ? '' : 'Postage for discovery mailing', width: 300 }, '= $', { value: values.postage, width: 60 }],
      [{ value: '', width: 300 }, '= $', { value: '', width: 60 }],
      ['Total Request (Time and Expenses): $', { value: values.total, width: 60 }],
    ],
    // An attached receipt.
    [['Item', 'Qty', 'Price', 'Amount'], ['Folders', '2', '$3.99', '$7.98'], ['Total $7.98']],
  ];
  const filled = form({ total: '640.35', attorney: ['1.5', '150', '225.00'], mileage: ['22', '.70', '15.40'], postage: '19.95' });

  it('reads labelled blanks typed above their lines, two to a line, and stops at the form’s total', async () => {
    const parsed = await extractFromTextLayer(await fillInFormPdf(filled));
    expect(parsed.lines.map((line) => [line.lineType, line.description, line.quantity, line.unitRate, line.amount])).toEqual([
      ['time', 'Attorney', 1.5, 150, 225],
      ['time', 'Attorney', 2, 175, 350],
      ['time', 'Travel', 0.4, 75, 30],
      ['expense', 'Mileage', 22, 0.7, 15.4],
      ['expense', 'Postage for discovery mailing', undefined, undefined, 19.95],
    ]);
    expect(parsed).toMatchObject({ invoiceNumber: 'SYN-0042', periodStart: '2026-03-01', periodEnd: '2026-03-31', statedTotal: 640.35 });
  });

  it('reads the same values left in live form fields', async () => {
    const flattened = await extractFromTextLayer(await fillInFormPdf(filled));
    expect(await extractFromTextLayer(await fillInFormPdf(filled, { fields: true }))).toEqual(flattened);
  });

  it('says when a form’s amounts are empty', async () => {
    const blank = [
      [
        ['Attorney:', { value: '' }, 'hrs.; $', { value: '' }, '/hour = $', { value: '0.00', width: 50 }],
        ['Total Request (Time and Expenses): $', { value: '', width: 60 }],
      ],
    ];
    await expect(extractFromTextLayer(await fillInFormPdf(blank))).rejects.toMatchObject({
      fieldErrors: { file: expect.stringContaining('amounts are empty') },
    });
  });
});

describe('files without readable items', () => {
  it('imports a stated total as one item to break down, such as a cover sheet sent alone', async () => {
    const parsed = await extractFromTextLayer(
      await letterPdf([['Request for Payment of Services', ['Provider:', 'Synthetic Provider'], ['TOTAL REQUESTED:', '$650.00']]]),
    );
    expect(parsed.lines).toEqual([{ location: 'stated total', lineType: 'other', description: 'Total requested (not itemized)', amount: 650 }]);
    expect(parsed.warnings?.map((warning) => warning.code)).toEqual(['not_itemized']);
  });

  it('does not take a figure in prose for a total', async () => {
    await expect(extractFromTextLayer(await letterPdf([['Guidance', 'Split travel (1.2 total) 0.6']]))).rejects.toMatchObject({
      fieldErrors: { file: expect.stringContaining('No table of invoice items') },
    });
  });

  it('refuses a request for pre-authorization, saying what to upload instead', async () => {
    await expect(
      extractFromTextLayer(
        await letterPdf([['Request for Pre-Authorization of Expenses', 'Rate: $150.00 / hour. Units Requested: 10', 'Total Requested: $1,500.00']]),
      ),
    ).rejects.toMatchObject({ fieldErrors: { file: expect.stringContaining('not a request for payment') } });
  });

  it('still reads an invoice that mentions a quotation', async () => {
    const parsed = await extractFromTextLayer(
      await tablesPdf([{ headings: ['Quotation Q-12 accepted'], rows: [], closing: '' }, { headings: ['Date', 'Description', 'Amount'], rows: [['01/06/2026', 'Filing fee', '$45.00']], closing: 'Balance due: $45.00' }]),
    );
    expect(parsed.lines.map((line) => line.amount)).toEqual([45]);
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
    expect(parseMoney('$ .70')).toBe(0.7);
  });
});
