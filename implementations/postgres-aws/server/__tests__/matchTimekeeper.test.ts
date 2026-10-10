import { describe, expect, it } from 'vitest';
import { matchTimekeeperName, nameTokens } from '../src/imports/matchTimekeeper';

const candidates = [
  { professionalId: 'jane', displayName: 'Jane Q. Smith' },
  { professionalId: 'john', displayName: 'John Smith' },
  { professionalId: 'ana', displayName: 'Ána Pérez' },
  { professionalId: 'firm', displayName: 'Smith, Jones and Lee' },
  { professionalId: 'unnamed', displayName: null },
];

describe('timekeeper name matching', () => {
  it('normalizes case, punctuation, accents and "Last, First" order', () => {
    expect(nameTokens('Jane  Q. Smith')).toEqual(['jane', 'q', 'smith']);
    expect(matchTimekeeperName('SMITH, JANE Q', candidates)).toBe('jane');
    expect(matchTimekeeperName('ana perez', candidates)).toBe('ana');
  });

  it('matches names that contain a comma, as written or reordered', () => {
    expect(matchTimekeeperName('Smith, Jones and Lee', candidates)).toBe('firm');
    expect(matchTimekeeperName('smith jones and lee', candidates)).toBe('firm');
    expect(matchTimekeeperName('Lee, Smith Jones and', candidates)).toBe('firm');
  });

  it('matches initials only when exactly one professional fits', () => {
    expect(matchTimekeeperName('J. Q. Smith', candidates)).toBe('jane');
    // Both Jane and John Smith start with J, and Jane has a middle name.
    expect(matchTimekeeperName('J. Smith', candidates)).toBe('john');
    expect(matchTimekeeperName('J Smith', [...candidates, { professionalId: 'joan', displayName: 'Joan Smith' }])).toBeUndefined();
  });

  it('leaves anything else unmatched', () => {
    expect(matchTimekeeperName('Smith', candidates)).toBeUndefined();
    expect(matchTimekeeperName('Unknown Person', candidates)).toBeUndefined();
    expect(matchTimekeeperName('  ', candidates)).toBeUndefined();
    expect(matchTimekeeperName('Jane Q Smith', candidates)).toBe('jane');
    expect(matchTimekeeperName('Jane Q Smith', [...candidates, { professionalId: 'dup', displayName: 'jane q smith' }])).toBeUndefined();
  });
});
