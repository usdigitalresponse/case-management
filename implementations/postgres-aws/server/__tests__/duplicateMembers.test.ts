import { afterEach, describe, expect, it, vi } from 'vitest';
import { duplicateGeneration, duplicateMembers, forgetDuplicates, membersOf, rememberDuplicateMembers, REMEMBER_DUPLICATES_MS } from '../src/duplicateMembers';

afterEach(() => {
  vi.useRealTimers();
  forgetDuplicates('people');
  forgetDuplicates('cases');
});

describe('remembered duplicate members, for a record\'s page', () => {
  it('names the other record in each pair', () => {
    const members = membersOf([['a', 'b'], ['a', 'c']], (id) => id.toUpperCase());
    expect(members.get('a')).toEqual([{ id: 'b', label: 'B' }, { id: 'c', label: 'C' }]);
    expect(members.get('b')).toEqual([{ id: 'a', label: 'A' }]);
  });

  it('works them out once, until they expire or are forgotten', async () => {
    vi.useFakeTimers();
    const list = vi.fn(async () => membersOf([['a', 'b']], (id) => id));
    await duplicateMembers('cases', list);
    await duplicateMembers('cases', list);
    expect(list).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REMEMBER_DUPLICATES_MS);
    await duplicateMembers('cases', list);
    expect(list).toHaveBeenCalledTimes(2);
    forgetDuplicates('cases');
    await duplicateMembers('cases', list);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('keeps each kind apart', async () => {
    await duplicateMembers('people', async () => membersOf([['p', 'q']], (id) => id));
    forgetDuplicates('cases');
    const list = vi.fn(async () => new Map());
    expect((await duplicateMembers('people', list)).get('p')).toEqual([{ id: 'q', label: 'q' }]);
    expect(list).not.toHaveBeenCalled();
  });

  it('takes a freshly listed set, but not one worked out before a change', async () => {
    rememberDuplicateMembers('people', membersOf([['a', 'b']], (id) => id), duplicateGeneration('people'));
    expect((await duplicateMembers('people', async () => new Map())).has('a')).toBe(true);

    const since = duplicateGeneration('people');
    forgetDuplicates('people');
    rememberDuplicateMembers('people', membersOf([['a', 'b']], (id) => id), since);
    expect((await duplicateMembers('people', async () => new Map())).has('a')).toBe(false);
  });
});
