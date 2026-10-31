// Who did the work on an invoice filed by person (design G), when a line
// names no one who could be matched: most invoices are one person's work, so
// the person most of its other lines were matched to, else the sender. The
// invoice never waits on intake for it. Names the sender typed for someone
// not listed are kept on the line.
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

// Fills every line with no one matched; returns how many were filled.
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
