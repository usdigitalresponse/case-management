import { afterEach, describe, expect, it } from 'vitest';
import { documentExtractor, EXTRACTORS } from '../src/imports/extractors';
import { parseDate, parseMoney } from '../src/imports/extractors/textLayer';
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

describe('text-layer value parsing', () => {
  it('reads common date formats and rejects impossible dates', () => {
    expect(parseDate('01/05/2026')).toBe('2026-01-05');
    expect(parseDate('1/5/26')).toBe('2026-01-05');
    expect(parseDate('2026-01-05')).toBe('2026-01-05');
    expect(parseDate('Jan. 5, 2026')).toBe('2026-01-05');
    expect(parseDate('February 30, 2026')).toBeUndefined();
    expect(parseDate('13/01/2026')).toBeUndefined();
  });

  it('reads the last amount in text, including thousands separators and credits', () => {
    expect(parseMoney('$1,013.90')).toBe(1013.9);
    expect(parseMoney('Total Due: $1,013.90')).toBe(1013.9);
    expect(parseMoney('($45.00)')).toBe(-45);
    expect(parseMoney('no amount')).toBeUndefined();
  });
});
