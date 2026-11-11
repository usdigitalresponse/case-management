// Possible duplicates, of people or cases, found in pairs and shown in
// groups: everything linked by any pair is likely one record kept several times.

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Each pair of ids sharing a key, with why.
export function pairsByKey<R>(rows: R[], idOf: (row: R) => string, keysOf: (row: R) => Array<string | null>, reason: string, into: Map<string, Set<string>>) {
  const byKey = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      if (key) byKey.set(key, (byKey.get(key) ?? new Set()).add(idOf(row)));
    }
  }
  for (const ids of byKey.values()) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = pairKey(list[i]!, list[j]!);
        into.set(key, (into.get(key) ?? new Set()).add(reason));
      }
    }
  }
}

export function groupPairs<P>(pairs: P[], idsOf: (pair: P) => [string, string]): P[][] {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;
    return up === id ? id : root(up);
  };
  for (const [a, b] of pairs.map(idsOf)) {
    if (root(a) !== root(b)) parent.set(root(a), root(b));
  }
  const groups = new Map<string, P[]>();
  for (const pair of pairs) {
    const key = root(idsOf(pair)[0]);
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  return [...groups.values()];
}
