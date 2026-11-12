import { describe, expect, it } from 'vitest';
import { countyChoiceOf, countyControlOptions, countyMatches } from './counties';

const options = [
  { countyId: 'a', displayName: 'Sample County', isCounty: true },
  { countyId: 'pc', displayName: 'Post-conviction', isCounty: false },
  { countyId: 'b', displayName: 'Example County', isCounty: true },
  { countyId: 'pr', displayName: 'Prison', isCounty: false },
];

describe('countyMatches', () => {
  it('lists settings before counties, and offers nothing to add before typing', () => {
    expect(countyMatches(options, '  ')).toEqual({
      matches: [options[1], options[3], options[0], options[2]],
      addName: null,
    });
  });

  it('matches as typed, ignoring the word county and punctuation', () => {
    expect(countyMatches(options, 'post conv').matches).toEqual([options[1]]);
    expect(countyMatches(options, 'county of sample')).toEqual({ matches: [options[0]], addName: null });
  });

  it('offers to add a county nothing listed has, as typed', () => {
    expect(countyMatches(options, ' Synthetic  County ')).toEqual({ matches: [], addName: 'Synthetic County' });
    expect(countyMatches(options, 'Sa')).toEqual({ matches: [options[0]], addName: 'Sa' });
    expect(countyMatches(options, 'county').addName).toBeNull();
  });
});

describe('a list’s county control', () => {
  // As the server lists them: settings first.
  const listed = [options[1]!, options[3]!, options[0]!, options[2]!];
  const counts = [
    { countyId: 'b', displayName: 'Example County', count: 1 },
    { countyId: null, displayName: null, count: 1 },
    { countyId: 'pr', displayName: 'Prison', count: 2 },
    { countyId: 'a', displayName: 'Sample County', count: 1 },
  ];

  it('offers every setting, and only the counties with rows, with counts', () => {
    const offered = countyControlOptions(counts, listed);
    expect(offered.settings.map((option) => [option.displayName, option.count])).toEqual([
      ['Post-conviction', 0],
      ['Prison', 2],
    ]);
    expect(offered.counties.map((option) => [option.displayName, option.count])).toEqual([
      ['Sample County', 1],
      ['Example County', 1],
    ]);
    expect(offered.none).toBe(1);
  });

  it('keeps offering the county chosen once no row has it, so the choice can be seen and undone', () => {
    const waiting = counts.filter((row) => row.countyId !== 'a');
    expect(countyControlOptions(waiting, listed, 'a').counties.map((option) => [option.displayName, option.count])).toContainEqual([
      'Sample County',
      0,
    ]);
  });

  it('offers a county no longer listed by its name, and every county without counts', () => {
    expect(countyControlOptions([{ countyId: 'x', displayName: 'Retired County', count: 3 }], listed).counties).toEqual([
      { countyId: 'x', displayName: 'Retired County', isCounty: true, count: 3 },
    ]);
    const unknown = countyControlOptions(null, listed);
    expect(unknown.counties.map((option) => [option.displayName, option.count])).toEqual([
      ['Sample County', null],
      ['Example County', null],
    ]);
    expect(unknown.none).toBeNull();
  });
});

describe('countyChoiceOf', () => {
  it('sends a listed county by id, a typed one by name, and none as a clear', () => {
    expect(countyChoiceOf({ countyId: 'a', displayName: 'Sample County' })).toEqual({ countyId: 'a' });
    expect(countyChoiceOf({ countyId: null, displayName: 'Synthetic County' })).toEqual({ countyName: 'Synthetic County' });
    expect(countyChoiceOf(null)).toEqual({ countyId: null });
  });
});
