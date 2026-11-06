import { describe, expect, it } from 'vitest';
import {
  ALL_COUNTIES,
  applyCountyControl,
  countyChoiceOf,
  countyControlOptions,
  countyMatches,
  GROUPED_BY_COUNTY,
  NO_COUNTY,
} from './counties';

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
  const rows = [
    { id: 1, countyId: 'b' },
    { id: 2, countyId: null },
    { id: 3, countyId: 'pr' },
    { id: 4, countyId: 'a' },
    { id: 5, countyId: 'pr' },
  ];
  const countyOf = (row: (typeof rows)[number]) => ({ countyId: row.countyId });
  const ids = (shown: typeof rows) => shown.map((row) => row.id);

  it('groups settings first, then counties as listed, then none, keeping each group’s order', () => {
    expect(ids(applyCountyControl(rows, countyOf, GROUPED_BY_COUNTY, listed))).toEqual([3, 5, 4, 1, 2]);
    expect(ids(applyCountyControl(rows, countyOf, ALL_COUNTIES, listed))).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows one county’s rows, or those with none', () => {
    expect(ids(applyCountyControl(rows, countyOf, 'pr', listed))).toEqual([3, 5]);
    expect(ids(applyCountyControl(rows, countyOf, NO_COUNTY, listed))).toEqual([2]);
  });

  it('offers every setting, and only the counties the rows have, with counts', () => {
    const offered = countyControlOptions(rows, countyOf, listed);
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
    const waiting = rows.filter((row) => row.countyId !== 'a');
    expect(countyControlOptions(waiting, countyOf, listed, 'a').counties.map((option) => [option.displayName, option.count])).toContainEqual([
      'Sample County',
      0,
    ]);
  });

  it('keeps each county no longer listed together when grouped', () => {
    const retired = [
      { id: 1, countyId: 'x' },
      { id: 2, countyId: 'y' },
      { id: 3, countyId: 'x' },
    ];
    expect(ids(applyCountyControl(retired, countyOf, GROUPED_BY_COUNTY, listed))).toEqual([1, 3, 2]);
  });
});

describe('countyChoiceOf', () => {
  it('sends a listed county by id, a typed one by name, and none as a clear', () => {
    expect(countyChoiceOf({ countyId: 'a', displayName: 'Sample County' })).toEqual({ countyId: 'a' });
    expect(countyChoiceOf({ countyId: null, displayName: 'Synthetic County' })).toEqual({ countyName: 'Synthetic County' });
    expect(countyChoiceOf(null)).toEqual({ countyId: null });
  });
});
