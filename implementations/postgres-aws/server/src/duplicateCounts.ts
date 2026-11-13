// How many groups of possible duplicates there are, remembered for a few
// minutes so opening People or All cases doesn't compare every record. The
// lists themselves are always worked out afresh, and store their count; a
// review, merge or undo forgets it. Kept in this one server process.
export type DuplicateKind = 'people' | 'cases';

export const REMEMBER_DUPLICATE_COUNT_MS = 5 * 60_000;

const remembered = new Map<DuplicateKind, { groups: number; at: number }>();
// Bumped on forgetting, so a count worked out meanwhile isn't kept.
const generation = new Map<DuplicateKind, number>();

// Taken before working a list out, and passed back when remembering its count.
export const duplicateGeneration = (kind: DuplicateKind) => generation.get(kind) ?? 0;

export function rememberDuplicateGroups(kind: DuplicateKind, groups: number, since: number): void {
  if (since === duplicateGeneration(kind)) remembered.set(kind, { groups, at: Date.now() });
}

export function forgetDuplicateGroups(kind: DuplicateKind): void {
  remembered.delete(kind);
  rememberedMembers.delete(kind);
  generation.set(kind, duplicateGeneration(kind) + 1);
}

// Requests arriving while a count is worked out wait for that one.
const pending = new Map<DuplicateKind, { since: number; groups: Promise<number> }>();

export async function duplicateGroupCount(kind: DuplicateKind, count: () => Promise<number>): Promise<number> {
  const hit = remembered.get(kind);
  if (hit && Date.now() - hit.at < REMEMBER_DUPLICATE_COUNT_MS) return hit.groups;
  const since = duplicateGeneration(kind);
  const running = pending.get(kind);
  if (running?.since === since) return running.groups;
  const groups = count().finally(() => {
    if (pending.get(kind)?.groups === groups) pending.delete(kind);
  });
  pending.set(kind, { since, groups });
  rememberDuplicateGroups(kind, await groups, since);
  return groups;
}

// For a case's or provider's page (design K32, K49): who each record may be a
// duplicate of, remembered as the count is and forgotten with it.
export interface DuplicateOther {
  id: string;
  label: string;
}

const rememberedMembers = new Map<DuplicateKind, { members: Map<string, DuplicateOther[]>; at: number }>();

export function rememberDuplicateMembers(kind: DuplicateKind, members: Map<string, DuplicateOther[]>, since: number): void {
  if (since === duplicateGeneration(kind)) rememberedMembers.set(kind, { members, at: Date.now() });
}

export async function duplicateMembers(kind: DuplicateKind, list: () => Promise<Map<string, DuplicateOther[]>>): Promise<Map<string, DuplicateOther[]>> {
  const hit = rememberedMembers.get(kind);
  if (hit && Date.now() - hit.at < REMEMBER_DUPLICATE_COUNT_MS) return hit.members;
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
