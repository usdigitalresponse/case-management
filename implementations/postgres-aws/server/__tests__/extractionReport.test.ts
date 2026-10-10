import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractReport, formatCsv, formatJson, formatText } from '../src/imports/extractionReport';
import { parseCsvRows } from '../src/imports/parseSpreadsheet';

const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'scenarios', 'fixtures', 'invoices');
const report = (file: string) => extractReport(file, readFileSync(join(SAMPLES_DIR, file)));

describe('extraction report formats', () => {
  it('gives the same items and errors as text, JSON and CSV', async () => {
    const reports = [await report('ledes-1998b-warnings.txt'), await report('template-bad-date.csv')];

    expect(formatText(reports)).toMatch(/not read: row 2: date "02\/03\/2026" must be YYYY-MM-DD/);

    const json = JSON.parse(formatJson(reports)) as Array<{ lines?: unknown[]; error?: string }>;
    expect(json[0]?.lines).toHaveLength(2);
    expect(json[1]?.error).toMatch(/YYYY-MM-DD/);

    // One row per item plus one for the unreadable file, with quoting that
    // round-trips through a CSV reader.
    const [header, ...rows] = parseCsvRows(formatCsv(reports)).filter((row) => row.length > 1);
    const column = (name: string) => header!.indexOf(name);
    expect(rows).toHaveLength(3);
    expect(rows[0]![column('location')]).toBe('line 3');
    expect(rows[0]![column('warnings')]).toMatch(/stated total|states a total/);
    expect(rows[1]![column('warnings')]).toMatch(/outside the billing period/);
    expect(rows[2]![column('file')]).toBe('template-bad-date.csv');
    expect(rows[2]![column('error')]).toMatch(/YYYY-MM-DD/);
  });
});
