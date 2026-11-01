import { describe, expect, it } from 'vitest';
import { matchesNote, shownCaseNumber } from './caseNumbers';

describe('case numbers as typed', () => {
  it('prefers a correction, then the typed number, to the case’s own', () => {
    expect(shownCaseNumber({ caseNumberAsTyped: '26CR340', caseNumberCorrected: '26-CR-00340', caseNumber: null })).toBe('26-CR-00340');
    expect(shownCaseNumber({ caseNumberAsTyped: '26CR340', caseNumberCorrected: null, caseNumber: '26-CR-00340' })).toBe('26CR340');
    expect(shownCaseNumber({ caseNumberAsTyped: null, caseNumberCorrected: null, caseNumber: '26-CR-00340' })).toBe('26-CR-00340');
  });

  it('says how many other invoices share the number', () => {
    expect(matchesNote({ same: 3, close: 1 })).toBe('Also on 3 other invoices. 1 close match.');
    expect(matchesNote({ same: 0, close: 2 })).toBe('2 close matches.');
    expect(matchesNote({ same: 0, close: 0 })).toBeNull();
  });
});
