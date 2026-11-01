// Filed by person, a line matched to no one is most likely the same person's
// work as the rest: the invoice's most common match, else the sender. So it
// never waits on intake; a name typed for someone not listed stays on the line.
import { and, eq, isNull } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invoiceLine } from '../db/schema';

export function fallbackTimekeeper(matched: Array<string | null | undefined>, senderProfessionalId: string | null): string | null {
  const counts = new Map<string, number>();
  for (const id of matched) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [id, count] of counts) {
    if (best === null || count > counts.get(best)!) best = id;
  }
  return best ?? senderProfessionalId;
}

// Returns how many lines were filled.
export async function fillUnmatchedTimekeepers(tx: Transaction, invoiceId: string, senderProfessionalId: string | null): Promise<number> {
  const lines = await tx
    .select({ timekeeperProfessionalId: invoiceLine.timekeeperProfessionalId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId));
  const fallback = fallbackTimekeeper(
    lines.map((line) => line.timekeeperProfessionalId),
    senderProfessionalId,
  );
  if (!fallback || lines.every((line) => line.timekeeperProfessionalId)) {
    return 0;
  }
  const filled = await tx
    .update(invoiceLine)
    .set({ timekeeperProfessionalId: fallback })
    .where(and(eq(invoiceLine.invoiceId, invoiceId), isNull(invoiceLine.timekeeperProfessionalId)))
    .returning({ id: invoiceLine.invoiceLineId });
  return filled.length;
}
