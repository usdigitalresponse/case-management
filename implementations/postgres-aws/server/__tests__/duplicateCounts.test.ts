import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  duplicateGeneration,
  duplicateGroupCount,
  duplicateMembers,
  forgetDuplicateGroups,
  membersOf,
  rememberDuplicateGroups,
  REMEMBER_DUPLICATE_COUNT_MS,
} from '../src/duplicateCounts';

afterEach(() => {
  vi.useRealTimers();
  forgetDuplicateGroups('people');
  forgetDuplicateGroups('cases');
});

describe('remembered duplicate counts', () => {
  it('works a count out once, until it expires', async () => {
    vi.useFakeTimers();
    const count = vi.fn(async () => 2);
    expect(await duplicateGroupCount('people', count)).toBe(2);
    expect(await duplicateGroupCount('people', count)).toBe(2);
    expect(count).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REMEMBER_DUPLICATE_COUNT_MS);
    await duplicateGroupCount('people', count);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('shares one count among requests made while it is worked out', async () => {
    let finish: (groups: number) => void = () => {};
    const count = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    const first = duplicateGroupCount('people', count);
    const second = duplicateGroupCount('people', count);
    finish(2);
    expect(await Promise.all([first, second])).toEqual([2, 2]);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('keeps people and cases apart, and forgets on a change', async () => {
    await duplicateGroupCount('people', async () => 3);
    expect(await duplicateGroupCount('cases', async () => 1)).toBe(1);
    forgetDuplicateGroups('people');
    expect(await duplicateGroupCount('people', async () => 0)).toBe(0);
    expect(await duplicateGroupCount('cases', async () => 9)).toBe(1);
  });

  it('takes a freshly listed count, but not one worked out before a change', async () => {
    rememberDuplicateGroups('people', 4, duplicateGeneration('people'));
    expect(await duplicateGroupCount('people', async () => 0)).toBe(4);

    const since = duplicateGeneration('people');
    forgetDuplicateGroups('people');
    rememberDuplicateGroups('people', 4, since);
    expect(await duplicateGroupCount('people', async () => 1)).toBe(1);
  });
});

describe('remembered duplicate members, for a record\'s page', () => {
  it('names the other record in each pair, and is forgotten with the count', async () => {
    const members = membersOf([['a', 'b'], ['a', 'c']], (id) => id.toUpperCase());
    expect(members.get('a')).toEqual([{ id: 'b', label: 'B' }, { id: 'c', label: 'C' }]);
    expect(members.get('b')).toEqual([{ id: 'a', label: 'A' }]);

    const list = vi.fn(async () => members);
    await duplicateMembers('cases', list);
    await duplicateMembers('cases', list);
    expect(list).toHaveBeenCalledTimes(1);
    forgetDuplicateGroups('cases');
    await duplicateMembers('cases', list);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
