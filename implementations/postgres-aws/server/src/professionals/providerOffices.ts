// Each provider's office and who can send their invoices: themselves once
// they can sign in, and their office's billing delegates
// (model/rules.yaml authorize_delegated_submission), for the Providers page.
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { office, personAffiliation, professional, userAccount } from '../db/schema';
import { getDelegateAffiliationRoleId } from './delegateRole';

export interface ProviderOffice {
  officeDisplayName: string | null;
  // Delegates at their office, other than themselves.
  sentByDisplayNames: string[];
  // How many others they send for, as a delegate.
  sendsForCount: number;
}

export async function loadProviderOffices(db: DatabaseOrTransaction, professionalIds: string[]): Promise<Map<string, ProviderOffice>> {
  const result = new Map<string, ProviderOffice>();
  if (professionalIds.length === 0) return result;
  const now = new Date();
  const current = and(lte(personAffiliation.startedAt, now), or(isNull(personAffiliation.endedAt), gt(personAffiliation.endedAt, now)));
  const delegateRoleId = await getDelegateAffiliationRoleId(db);
  const [own, delegates] = await Promise.all([
    db
      .select({
        professionalId: professional.professionalId,
        personId: professional.personId,
        officeId: personAffiliation.officeId,
        officeDisplayName: office.displayName,
      })
      .from(professional)
      .innerJoin(personAffiliation, eq(personAffiliation.personId, professional.personId))
      .innerJoin(office, eq(personAffiliation.officeId, office.officeId))
      .where(and(inArray(professional.professionalId, professionalIds), isNotNull(personAffiliation.officeId), current)),
    db
      .select({ personId: userAccount.personId, officeId: personAffiliation.officeId, displayName: userAccount.displayName })
      .from(userAccount)
      .innerJoin(personAffiliation, eq(personAffiliation.personId, userAccount.personId))
      .where(and(eq(userAccount.active, true), eq(personAffiliation.affiliationRoleId, delegateRoleId), isNotNull(personAffiliation.officeId), current)),
  ]);
  const peopleAt = new Map<string, Set<string>>();
  for (const row of own) {
    peopleAt.set(row.officeId!, (peopleAt.get(row.officeId!) ?? new Set()).add(row.personId));
  }
  for (const professionalId of professionalIds) {
    const offices = own.filter((row) => row.professionalId === professionalId);
    const personId = offices[0]?.personId;
    const officeIds = new Set(offices.map((row) => row.officeId!));
    const sentBy = delegates.filter((row) => officeIds.has(row.officeId!) && row.personId !== personId);
    const delegatesFor = delegates.filter((row) => row.personId === personId).map((row) => row.officeId!);
    const others = new Set(delegatesFor.flatMap((officeId) => [...(peopleAt.get(officeId) ?? [])]).filter((id) => id !== personId));
    result.set(professionalId, {
      officeDisplayName: [...new Set(offices.map((row) => row.officeDisplayName))].join(', ') || null,
      sentByDisplayNames: [...new Set(sentBy.map((row) => row.displayName))].sort(),
      sendsForCount: others.size,
    });
  }
  return result;
}
