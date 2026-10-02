import { describe, expect, it } from 'vitest';
import { parseCommaSeparatedList } from '../src/auth/emailLists';

describe('parseCommaSeparatedList', () => {
  it('returns an empty list for undefined or blank input', () => {
    expect(parseCommaSeparatedList(undefined)).toEqual([]);
    expect(parseCommaSeparatedList('')).toEqual([]);
    expect(parseCommaSeparatedList('  ,  ,')).toEqual([]);
  });

  it('trims, lowercases, and drops empty entries', () => {
    expect(parseCommaSeparatedList(' Foo@Bar.com , baz.gov ,,')).toEqual(['foo@bar.com', 'baz.gov']);
  });
});
