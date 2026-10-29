import { describe, expect, it } from 'vitest';
import { matchKeys, namedIn } from '../src/imports/caseMatching';

const cases = [
  { id: 'sample', keys: matchKeys('Jane Sample', ['CR-0001']) },
  { id: 'nunez', keys: matchKeys('José Núñez', ['CR-0002']) },
  { id: 'lee', keys: matchKeys('Ann Lee', ['MATTER-A']) },
];

const named = (text: string) => namedIn(text, cases, (row) => row.keys).map((row) => row.id);

describe('finding the case a file names', () => {
  it('matches numbers and names regardless of spacing, punctuation, accents, case or name order', () => {
    expect(named('Case No.: cr 0001')).toEqual(['sample']);
    expect(named('Client: JOSE NUNEZ')).toEqual(['nunez']);
    expect(named('Client: Sample, Jane')).toEqual(['sample']);
    expect(named('Núñez, José')).toEqual(['nunez']);
  });

  it('takes a label that is exactly a short key, but not a short key inside other text', () => {
    const short = [{ id: 'a1', keys: matchKeys(null, ['A1']) }];
    expect(namedIn('A1', short, (row) => row.keys).map((row) => row.id)).toEqual(['a1']);
    expect(namedIn('Plan A1 of 3', short, (row) => row.keys)).toEqual([]);
  });

  it('matches a number written without its separators', () => {
    expect(named('Ref CR0001 services')).toEqual(['sample']);
    expect(named('Ref CR0002')).toEqual(['nunez']);
    // Numbers aren't loosened beyond that.
    expect(named('Ref CR0003')).toEqual([]);
    expect(named('Ref CR001')).toEqual([]);
  });

  it('matches a name with a middle name or initial, or with only the given initial', () => {
    expect(named('Client: Jane Q. Sample')).toEqual(['sample']);
    expect(named('Client: Jane Quinn Sample')).toEqual(['sample']);
    expect(named('Client: J. Sample')).toEqual(['sample']);
    expect(named('Sample, J.')).toEqual(['sample']);
  });

  it('allows one slip in a long name', () => {
    expect(named('Client: Jane Smaple')).toEqual(['sample']);
    expect(named('Client: Jane Sampe')).toEqual(['sample']);
    expect(named('Client: Jose Nunes')).toEqual(['nunez']);
  });

  it('does not stretch to a family name alone, two slips, short names, or a far-off given name', () => {
    expect(named('Research on the sample motion')).toEqual([]);
    expect(named('Client: Jane Smaplr')).toEqual([]);
    expect(named('Client: Ann Lea')).toEqual([]);
    expect(named('Jane met with the court about the Sample matter')).toEqual([]);
    // Not an article or a possessive's "s" taken for an initial.
    const brown = [{ id: 'brown', keys: matchKeys('Alex Brown', []) }, { id: 'gray', keys: matchKeys('Sam Gray', []) }];
    expect(namedIn('Mailed in a brown envelope', brown, (row) => row.keys)).toEqual([]);
    expect(namedIn('Reviewed Dr. Gray’s report', brown, (row) => row.keys)).toEqual([]);
  });

  it('ignores a name suffix', () => {
    const suffixed = [{ id: 'smith', keys: matchKeys('John Smith Jr.', []) }];
    expect(namedIn('Client: Smith, John', suffixed, (row) => row.keys).map((row) => row.id)).toEqual(['smith']);
    expect(namedIn('Client: John Q. Smith Jr', suffixed, (row) => row.keys).map((row) => row.id)).toEqual(['smith']);
  });

  it('finds an all-digit number in text only when it is long enough not to be a date or amount', () => {
    const numbered = [
      { id: 'year', keys: matchKeys(null, ['2026']) },
      { id: 'long', keys: matchKeys(null, ['20260115']) },
    ];
    const ids = (text: string) => namedIn(text, numbered, (row) => row.keys).map((row) => row.id);
    expect(ids('Invoice date 2026-01-10, total $2,026.00')).toEqual([]);
    expect(ids('2026')).toEqual(['year']);
    expect(ids('Case No.: 20260115')).toEqual(['long']);
    expect(ids('Service on 2026 01 15')).toEqual([]);
  });

  it('prefers an exact match over a loose one', () => {
    const similar = [...cases, { id: 'sampel', keys: matchKeys('Jane Sampel', ['CR-0009']) }];
    expect(namedIn('Client: Jane Sampel', similar, (row) => row.keys).map((row) => row.id)).toEqual(['sampel']);
  });

  it('returns every loose match, so an unclear file suggests none', () => {
    const twins = [...cases, { id: 'samples', keys: matchKeys('Jane Samples', ['CR-0010']) }];
    expect(namedIn('Client: J. Sample', twins, (row) => row.keys).map((row) => row.id)).toEqual(['sample', 'samples']);
  });
});
