// The seeded demo accounts a guided tour plays: the staff demo sign-in,
// the Director who signs off, and an investigator who sends invoices.
import { eq } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { userAccount } from '../db/schema';
import { listDemoPartners, listDemoStaff, STAFF_DEMO_EMAIL } from '../auth/demoAccounts';
import { canSignOff } from '../billing/reviewSettings';
import { resolvePortalActor } from '../portal/portalActor';

export type TourRole = 'staff' | 'director' | 'vendor';

export interface TourAccounts {
  staff: string;
  director: string;
  vendor: string;
  vendorProfessionalId: string;
  vendorName: string;
}

export class TourAccountsMissing extends Error {}

// Finishing a review and signing off take two people, so these missions need a Director besides the reviewer.
const NEEDS_DIRECTOR = new Set(['staff-filing', 'answer-finish', 'sign-off']);

export async function findTourAccounts(db: DatabaseOrTransaction, mission: string): Promise<TourAccounts> {
  const [staffAccount] = await db.select({ id: userAccount.userAccountId }).from(userAccount).where(eq(userAccount.email, STAFF_DEMO_EMAIL));
  const partners = await listDemoPartners(db);
  const vendor = partners.find((partner) => /investigator/i.test(partner.description ?? '')) ?? partners[0];
  if (!staffAccount || !vendor) {
    throw new TourAccountsMissing('The demo accounts are missing; reset the demo data first.');
  }
  let director: string | undefined;
  for (const candidate of await listDemoStaff(db)) {
    // eslint-disable-next-line no-await-in-loop
    if (candidate.userAccountId !== staffAccount.id && (await canSignOff(db, candidate.userAccountId))) {
      director = candidate.userAccountId;
      break;
    }
  }
  if (!director && NEEDS_DIRECTOR.has(mission)) {
    throw new TourAccountsMissing('This part of the tour needs a second demo staff member who signs off; reset the demo data first.');
  }
  const actor = await resolvePortalActor(db, vendor.userAccountId);
  if (!actor.professionalId) {
    throw new TourAccountsMissing('The demo investigator has no provider profile; reset the demo data first.');
  }
  return {
    staff: staffAccount.id,
    // Unused by the missions that don't need one.
    director: director ?? staffAccount.id,
    vendor: vendor.userAccountId,
    vendorProfessionalId: actor.professionalId,
    vendorName: vendor.displayName,
  };
}
