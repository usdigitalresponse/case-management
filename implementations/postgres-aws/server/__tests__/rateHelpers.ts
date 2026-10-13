import { randomUUID } from 'node:crypto';
import type { Database } from '../src/db/client';
import { addKindRate, createKind, setProfessionalKind } from '../src/billing/professionalRates';

// Gives the professional a kind of their own with one hourly rate, so their
// time can be priced. Returns the kind, for adding later rates.
export async function giveRate(
  db: Database,
  adminUserAccountId: string,
  professionalId: string,
  hourlyRate: number,
  effectiveFrom = '2025-01-01',
): Promise<string> {
  const { professionalKindId } = await createKind(db, { displayName: `Synthetic kind ${randomUUID()}` });
  await addKindRate(db, adminUserAccountId, professionalKindId, { hourlyRate, effectiveFrom });
  await setProfessionalKind(db, professionalId, { professionalKindId });
  return professionalKindId;
}
