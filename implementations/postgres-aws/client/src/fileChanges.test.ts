import { describe, expect, it } from 'vitest';
import type { FileLine, FileSource } from './api/client';
import { changedFields, changeSentence, rowsInFileOrder } from './fileChanges';
import { totalsNotice } from './portal/checkLines';

const read = (location: string, patch: Partial<FileLine> = {}): FileLine => ({
  location,
  lineType: 'time',
  serviceDate: '2026-09-02',
  description: 'Reviewed discovery',
  quantity: 3.5,
  unitRate: 125,
  amount: 437.5,
  ...patch,
});

describe('changes from the file', () => {
  it('compares what the submitter can change', () => {
    const mileage = read('row 4', { lineType: 'mileage', quantity: 84, unitRate: 0.7, amount: 58.8, description: 'Mileage' });
    const values = { lineType: 'mileage' as const, serviceDate: '2026-09-02', description: 'Mileage', quantity: 64, unitRate: 0.7, amount: 44.8 };
    expect(changedFields(mileage, values)).toEqual(['quantity']);
    expect(changeSentence(mileage, values, ['quantity'])).toBe('You changed miles from 84 to 64.');
    expect(changedFields(read('row 2'), { ...values, lineType: 'time', quantity: 3.5, unitRate: 125, description: 'Reviewed discovery', amount: 437.5 })).toEqual([]);
  });

  it('keeps removed lines in file order, with added lines after', () => {
    const fileLines = [read('row 2'), read('row 3'), read('row 4')];
    const lines = [{ at: 'row 4' }, { at: null }, { at: 'row 2' }];
    const rows = rowsInFileOrder(fileLines, lines, (line) => line.at);
    expect(rows.map((row) => [row.kind, row.number])).toEqual([
      ['line', 1],
      ['removed', 2],
      ['line', 3],
      ['line', 4],
    ]);
  });
});

describe('the totals notice', () => {
  const source = (statedTotal: number | null, lines: FileLine[]): FileSource => ({
    invoiceImportId: 'i',
    importStatusCode: 'extracted',
    fileName: 'f.pdf',
    formatCode: 'document',
    fileAvailable: true,
    invoiceNumber: null,
    statedTotal,
    lines,
    warnings: [],
  });
  const none = { removed: [], changed: [], added: [], duplicates: new Map<number, number>(), warningLine: null };

  it('says by how much a misread file is off, and where to look', () => {
    const notice = totalsNotice({
      ...none,
      source: source(1044.8, [read('a', { amount: 1000 }), read('b', { amount: 58.8 })]),
      askingFor: 1058.8,
      warningLine: { number: 3, message: 'We could not read the miles clearly.' },
    });
    expect(notice).toEqual({
      tone: 'warning',
      text: 'Your file says the total is $1,044.80. The lines we read add up to $1,058.80, which is $14.00 more. Check line 3: we could not read the miles clearly.',
    });
  });

  it('explains a difference the submitter made', () => {
    const notice = totalsNotice({
      ...none,
      source: source(1044.8, [read('a', { amount: 982.3 }), read('b', { amount: 62.5 })]),
      askingFor: 982.3,
      removed: [6],
    });
    expect(notice?.tone).toBe('success');
    expect(notice?.text).toContain('That is $62.50 less than your file, because you removed line 6.');
  });

  it('matches, and points out a likely duplicate', () => {
    const notice = totalsNotice({
      ...none,
      source: source(125, [read('a', { amount: 125 })]),
      askingFor: 125,
      duplicates: new Map([[6, 5]]),
    });
    expect(notice?.text).toBe('The lines add up to $125.00, the same as the total on your file. Check line 6: it looks the same as line 5.');
  });
});
