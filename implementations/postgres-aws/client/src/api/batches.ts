// Long lists come a batch at a time (the server's src/lists/batches.ts).
export interface Batch<T, Summary = never> {
  items: T[];
  // Asks for the next batch; null after the last.
  next: string | null;
  // The whole list's counts and the like, on the first batch only.
  summary?: Summary;
}

// The most rows the server sends in one batch, for exports.
export const LARGEST_BATCH = 200;

// The query string for one batch, after the page's own parameters.
export function batchParams(params: URLSearchParams, after: string | null): URLSearchParams {
  if (after) params.set('after', after);
  return params;
}

// Every batch, for an export of the whole list.
export async function loadAllBatches<T>(load: (after: string | null) => Promise<Batch<T, unknown>>): Promise<T[]> {
  const items: T[] = [];
  let after: string | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop
    const batch: Batch<T, unknown> = await load(after);
    items.push(...batch.items);
    after = batch.next;
  } while (after);
  return items;
}
