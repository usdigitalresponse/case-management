import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import { detectTimeLogColumns, parseLogDate, parseLogHours, parseLogTime, readTimeLog, type TimeLogEntry } from '../src/imports/readTimeLog';
import { compareWithTimeLog, NOT_A_PERSON, type CheckLine } from '../src/billing/timeLogCheck';
import { ValidationError } from '../src/errors';

const EXPORT_HEADERS = ['ID (with Link)', 'Date of Service', 'Stop Time', 'Start Time', 'Time Spent', 'Activity Type', 'Caseworker', 'Activity Details'];
const PERSON = { professionalId: 'p1', displayName: 'Avery Example' };

let row = 0;
function entry(date: string, hours: number, worker = PERSON.displayName, extra: Partial<TimeLogEntry> = {}): TimeLogEntry {
  row += 1;
  return { key: `r${row}`, entryId: null, date, hours, worker, details: null, start: null, stop: null, ...extra };
}

const time = (id: string, serviceDate: string, quantity: number, professionalId: string | null = PERSON.professionalId): CheckLine => ({
  invoiceLineId: id,
  lineTypeCode: 'time',
  serviceDate,
  quantity,
  professionalId,
});

function compare(lines: CheckLine[], entries: TimeLogEntry[], options: { workerMatches?: Record<string, string>; lineLinks?: Record<string, string[]> } = {}) {
  return compareWithTimeLog({
    lines,
    entries,
    people: [PERSON],
    workerMatches: options.workerMatches ?? {},
    lineLinks: options.lineLinks ?? {},
    period: { start: '2026-03-01', end: '2026-03-31' },
  });
}

const statuses = (result: ReturnType<typeof compare>) => result.lines.map((line) => [line.status, line.flagged]);

describe('reading a time log', () => {
  it("finds the export's columns by header", () => {
    expect(detectTimeLogColumns(EXPORT_HEADERS)).toEqual({ entryId: 0, date: 1, stop: 2, start: 3, hours: 4, worker: 6, details: 7 });
  });

  it('finds columns under other common headers', () => {
    expect(detectTimeLogColumns(['Entry #', 'Work Date', 'Time In', 'Time Out', 'Billable Hours', 'Attorney', 'Comments'])).toEqual({
      entryId: 0,
      date: 1,
      start: 2,
      stop: 3,
      hours: 4,
      worker: 5,
      details: 6,
    });
    expect(detectTimeLogColumns(['Date', 'Total Hours', 'Provider', 'Summary'])).toMatchObject({ date: 0, hours: 1, worker: 2, details: 3 });
  });

  it('prefers the service date and the worker over other dates and names', () => {
    expect(detectTimeLogColumns(['Date Created', 'Client Name', 'Case Name', 'Date of Service', 'Hours', 'Staff Member'])).toEqual({
      date: 3,
      hours: 4,
      worker: 5,
    });
  });

  it('reads time spent in minutes', async () => {
    expect(detectTimeLogColumns(['Date', 'Minutes', 'User'])).toEqual({ date: 0, minutes: 1, worker: 2 });
    const read = await readTimeLog(Buffer.from('Date,Time Spent (minutes),User\r\n2026-03-03,90,Avery Example\r\n'), 'log.csv');
    expect(read.needsColumns === false && read.entries[0]!.hours).toBe(1.5);
    expect(parseLogHours('1h 30m')).toBe(1.5);
    expect(parseLogHours('90 min')).toBe(1.5);
    expect(parseLogHours('2 hrs')).toBe(2);
  });

  it('reads a spreadsheet duration cell as hours', () => {
    expect(parseLogHours('1899-12-30T01:30:00.000Z')).toBe(1.5);
    expect(parseLogHours('1899-12-31T02:00:00.000Z')).toBe(26);
  });

  it('finds the header below title rows', async () => {
    const csv = 'Time report,,\r\nMar 1 - Mar 31 2026,,\r\n,,\r\nDate,Hours,Caseworker\r\n2026-03-03,2,Avery Example\r\n';
    const read = await readTimeLog(Buffer.from(csv), 'log.csv');
    expect(read.needsColumns === false && read.entries).toEqual([
      { key: 'r5', entryId: null, date: '2026-03-03', hours: 2, worker: 'Avery Example', details: null, start: null, stop: null },
    ]);
  });

  it('reads dates and times as written in exports', () => {
    expect(parseLogDate('Mar 3, 2026')).toBe('2026-03-03');
    expect(parseLogDate('3/3/2026')).toBe('2026-03-03');
    expect(parseLogDate('2026-03-03')).toBe('2026-03-03');
    expect(parseLogDate('Feb 30, 2026')).toBeNull();
    expect(parseLogTime('12:30 PM')).toBe('12:30');
    expect(parseLogTime('12:15 AM')).toBe('00:15');
    expect(parseLogTime('13:00')).toBe('13:00');
  });

  it('reads a CSV whose columns are in another order', async () => {
    const csv = 'Caseworker,Time Spent,Date of Service\r\nAvery Example,1.5,"Mar 3, 2026"\r\n,,\r\n';
    const read = await readTimeLog(Buffer.from(csv), 'log.csv');
    expect(read.needsColumns).toBe(false);
    expect(read.needsColumns === false && read.entries).toEqual([
      { key: 'r2', entryId: null, date: '2026-03-03', hours: 1.5, worker: 'Avery Example', details: null, start: null, stop: null },
    ]);
  });

  it('reads an XLSX export', async () => {
    const bytes = await writeXlsxFile(
      [
        EXPORT_HEADERS.map((value) => ({ value })),
        [{ value: '#100' }, { value: 'Mar 10, 2026' }, { value: '12:30 PM' }, { value: '9:00 AM' }, { value: 3, type: Number }, { value: 'Attorney' }, { value: 'Avery Example' }, { value: '' }],
      ],
      {},
    ).toBuffer();
    const read = await readTimeLog(bytes, 'log.xlsx');
    expect(read.needsColumns === false && read.entries[0]).toMatchObject({ entryId: '#100', date: '2026-03-10', hours: 3, start: '09:00', stop: '12:30' });
  });

  it('asks for the columns when it cannot find them, and uses the ones chosen', async () => {
    const csv = 'invoice_number,day,amount,who\r\nSYN-1,2026-03-03,2,Avery Example\r\n';
    expect(await readTimeLog(Buffer.from(csv), 'log.csv')).toEqual({ needsColumns: true, headers: ['invoice_number', 'day', 'amount', 'who'] });
    const chosen = await readTimeLog(Buffer.from(csv), 'log.csv', { date: 1, hours: 2, worker: 3 });
    expect(chosen.needsColumns === false && chosen.entries[0]).toMatchObject({ date: '2026-03-03', hours: 2, worker: 'Avery Example' });
  });

  it('refuses a file that is not CSV or XLSX', async () => {
    await expect(readTimeLog(Buffer.from('x'), 'log.pdf')).rejects.toThrow(ValidationError);
  });
});

describe('comparing lines with a time log', () => {
  it('matches every line on date, person and hours, and leaves out entries outside the period', () => {
    const result = compare(
      [time('a', '2026-03-03', 2), time('b', '2026-03-10', 3.5)],
      [entry('2026-03-03', 2), entry('2026-03-10', 3.5, PERSON.displayName, { start: '09:00', stop: '12:30' }), entry('2026-02-20', 1)],
    );
    expect(statuses(result)).toEqual([['matched', false], ['matched', false]]);
    expect(result.entries.map((e) => e.use)).toEqual(['matched', 'matched', 'outside_period']);
    expect(result.entries[1]!.clockHours).toBeNull();
  });

  it('flags hours that differ, a line not in the log, and lists unbilled time', () => {
    const result = compare(
      [time('a', '2026-03-10', 3.5), time('b', '2026-03-12', 1)],
      [entry('2026-03-10', 3, PERSON.displayName, { start: '09:00', stop: '12:30' }), entry('2026-03-20', 1.25)],
    );
    expect(statuses(result)).toEqual([['hours_differ', true], ['not_in_log', true]]);
    expect(result.lines[0]!.loggedHours).toBe(3);
    expect(result.entries[0]!.clockHours).toBe(3.5);
    expect(result.entries[1]!.use).toBe('unbilled');
  });

  it("suggests a name variant but doesn't use it until confirmed", () => {
    const entries = [entry('2026-03-03', 2, 'Avery E.'), entry('2026-03-04', 1, 'Example, Avery')];
    const before = compare([time('a', '2026-03-03', 2)], entries);
    expect(before.workers.map((w) => [w.name, w.suggestedProfessionalId, w.professionalId])).toEqual([
      ['Avery E.', 'p1', null],
      ['Example, Avery', 'p1', null],
    ]);
    expect(statuses(before)).toEqual([['other_account', true]]);
    const after = compare([time('a', '2026-03-03', 2)], entries, { workerMatches: { 'Avery E.': 'p1' } });
    expect(statuses(after)).toEqual([['matched', false]]);
  });

  it('finds a line split across entries, and time logged under an account that is not a person', () => {
    const result = compare(
      [time('a', '2026-03-14', 1), time('b', '2026-03-14', 5.5), time('c', '2026-03-08', 1.5)],
      [entry('2026-03-14', 2.5), entry('2026-03-14', 3), entry('2026-03-14', 1), entry('2026-03-08', 1.5, 'Front_Desk Office')],
      { workerMatches: { 'Front_Desk Office': NOT_A_PERSON } },
    );
    expect(statuses(result)).toEqual([['matched', false], ['combined', true], ['other_account', true]]);
    expect(result.lines[1]!.loggedHours).toBe(5.5);
    expect(result.dailyTotals.find((total) => total.date === '2026-03-14')).toMatchObject({ billed: 6.5, logged: 6.5 });
  });

  it('notes the same hours logged a day apart, and two identical entries for one line', () => {
    const result = compare(
      [time('a', '2026-03-15', 3.25), time('b', '2026-03-03', 1.5)],
      [entry('2026-03-14', 3.25), entry('2026-03-03', 1.5), entry('2026-03-03', 1.5)],
    );
    expect(statuses(result)).toEqual([['date_differs', true], ['several', true]]);
    expect(result.lines[1]!.entryKeys).toHaveLength(2);
  });

  it("uses the reviewer's links, flagged only while their hours differ", () => {
    const entries = [entry('2026-03-14', 3.25), entry('2026-03-03', 1.5), entry('2026-03-03', 1.5)];
    const [dayBefore, first, second] = entries;
    const result = compare([time('a', '2026-03-15', 3.25), time('b', '2026-03-03', 1.5)], entries, {
      lineLinks: { a: [dayBefore!.key], b: [first!.key] },
    });
    expect(statuses(result)).toEqual([['linked', false], ['linked', false]]);
    expect(result.entries.find((e) => e.key === second!.key)!.use).toBe('unbilled');
    const short = compare([time('a', '2026-03-15', 4)], entries, { lineLinks: { a: [dayBefore!.key] } });
    expect(statuses(short)).toEqual([['linked', true]]);
  });

  it('keeps a linked entry whose date no longer reads out of the daily totals', () => {
    const undated = entry('2026-03-03', 2, PERSON.displayName, { date: null });
    const result = compare([time('a', '2026-03-03', 2)], [undated], { lineLinks: { a: [undated.key] } });
    expect(statuses(result)).toEqual([['linked', false]]);
    expect(result.dailyTotals).toEqual([{ date: '2026-03-03', professionalId: 'p1', billed: 2, logged: 0 }]);
  });

  it('never matches a name with no letters to compare', () => {
    const result = compareWithTimeLog({
      lines: [time('a', '2026-03-03', 2, 'p2')],
      entries: [entry('2026-03-03', 2, '-')],
      people: [{ professionalId: 'p2', displayName: '' }],
      workerMatches: {},
      lineLinks: {},
      period: { start: '2026-03-01', end: '2026-03-31' },
    });
    expect(result.workers[0]).toMatchObject({ name: '-', professionalId: null, automatic: false });
    expect(statuses(result)).toEqual([['other_account', true]]);
  });

  it("doesn't check lines that aren't time", () => {
    const result = compare([{ invoiceLineId: 'fee', lineTypeCode: 'expense', serviceDate: '2026-03-24', quantity: null, professionalId: 'p1' }], []);
    expect(statuses(result)).toEqual([['not_checked', false]]);
  });
});
