import { describe, expect, it } from 'vitest';
import { parseBillingRecordChoices, parseExportChoices } from './exportChoices';

describe('parseExportChoices', () => {
  it('starts with a full PDF', () => {
    expect(parseExportChoices(null)).toEqual({ format: 'pdf', omit: [] });
    expect(parseExportChoices('not json')).toEqual({ format: 'pdf', omit: [] });
  });

  it('keeps saved choices and drops fields an export no longer has', () => {
    const saved = JSON.stringify({ format: 'xlsx', omit: ['lines:Description', 'lines:Retired column', 7] });
    expect(parseExportChoices(saved)).toEqual({ format: 'xlsx', omit: ['lines:Description'] });
  });
});

describe('parseBillingRecordChoices', () => {
  it('starts with a full spreadsheet of signed-off invoices', () => {
    expect(parseBillingRecordChoices(null)).toEqual({ format: 'xlsx', signedOffOnly: true, omit: [] });
  });

  it('keeps saved columns it can leave out, never the reference or amounts', () => {
    const saved = JSON.stringify({ format: 'csv', signedOffOnly: false, omit: ['Client', 'Invoice number', 'Amount requested', 'Retired column'] });
    expect(parseBillingRecordChoices(saved)).toEqual({ format: 'csv', signedOffOnly: false, omit: ['Client'] });
  });
});
