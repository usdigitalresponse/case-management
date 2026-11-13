// Who each case or person may be a duplicate of, for the notice on its page
// (design K32, K49), remembered for a few minutes so opening a page doesn't
// compare every record. Settings › Merge duplicates always works its lists out
// afresh and stores them here; a review, merge, undo or case fix forgets them.
// Kept in this one server process.
export type DuplicateKind = 'people' | 'cases';

export const REMEMBER_DUPLICATES_MS = 5 * 60_000;

export interface DuplicateOther {
  id: string;
  label: string;
}

const remembered = new Map<DuplicateKind, { members: Map<string, DuplicateOther[]>; at: number }>();
// Bumped on forgetting, so members worked out meanwhile aren't kept.
const generation = new Map<DuplicateKind, number>();

// Taken before working a list out, and passed back when remembering it.
export const duplicateGeneration = (kind: DuplicateKind) => generation.get(kind) ?? 0;

export function rememberDuplicateMembers(kind: DuplicateKind, members: Map<string, DuplicateOther[]>, since: number): void {
  if (since === duplicateGeneration(kind)) remembered.set(kind, { members, at: Date.now() });
}

export function forgetDuplicates(kind: DuplicateKind): void {
  remembered.delete(kind);
  generation.set(kind, duplicateGeneration(kind) + 1);
}

export async function duplicateMembers(kind: DuplicateKind, list: () => Promise<Map<string, DuplicateOther[]>>): Promise<Map<string, DuplicateOther[]>> {
  const hit = remembered.get(kind);
  if (hit && Date.now() - hit.at < REMEMBER_DUPLICATES_MS) return hit.members;
  const since = duplicateGeneration(kind);
  const members = await list();
  rememberDuplicateMembers(kind, members, since);
  return members;
}

// Each record in a pair, with the other.
export function membersOf(pairs: Array<[string, string]>, labelOf: (id: string) => string): Map<string, DuplicateOther[]> {
  const members = new Map<string, DuplicateOther[]>();
  for (const [a, b] of pairs) {
    members.set(a, [...(members.get(a) ?? []), { id: b, label: labelOf(b) }]);
    members.set(b, [...(members.get(b) ?? []), { id: a, label: labelOf(a) }]);
  }
  return members;
}
