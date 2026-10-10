// Who a portal user may act for: themselves, and as a delegate, active
// professionals in their office (model/rules.yaml
// authorize_delegated_submission). Either way the professional must be
// assigned to the case.
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseAssignment, personAffiliation, professional, userAccount } from '../db/schema';
import { getDelegateAffiliationRoleId } from '../professionals/delegateRole';
import { getProfessionalIdForUserAccount } from '../professionals/ensureProfessional';

export interface PortalActor {
  userAccountId: string;
  // Absent for a delegate who has no professional profile of their own.
  professionalId: string | undefined;
}

export async function resolvePortalActor(db: DatabaseOrTransaction, userAccountId: string): Promise<PortalActor> {
  return { userAccountId, professionalId: await getProfessionalIdForUserAccount(db, userAccountId) };
}

// Start-inclusive, end-exclusive (model/rules.yaml validate_effective_relationships).
function effectiveAt(at: Date) {
  return and(
    lte(personAffiliation.startedAt, at),
    or(isNull(personAffiliation.endedAt), gt(personAffiliation.endedAt, at)),
  );
}

export async function delegateOfficeIds(
  db: DatabaseOrTransaction,
  userAccountId: string,
  at: Date = new Date(),
): Promise<string[]> {
  const delegateRoleId = await getDelegateAffiliationRoleId(db);
  const rows = await db
    .select({ officeId: personAffiliation.officeId })
    .from(userAccount)
    .innerJoin(personAffiliation, eq(personAffiliation.personId, userAccount.personId))
    .where(
      and(
        eq(userAccount.userAccountId, userAccountId),
        eq(userAccount.active, true),
        eq(personAffiliation.affiliationRoleId, delegateRoleId),
        isNotNull(personAffiliation.officeId),
        effectiveAt(at),
      ),
    );
  return [...new Set(rows.flatMap((row) => (row.officeId ? [row.officeId] : [])))];
}

export async function representedProfessionalIds(
  db: DatabaseOrTransaction,
  userAccountId: string,
  caseId?: string,
  at: Date = new Date(),
): Promise<string[]> {
  const officeIds = await delegateOfficeIds(db, userAccountId, at);
  if (officeIds.length === 0) {
    return [];
  }
  const conditions = [
    inArray(personAffiliation.officeId, officeIds),
    effectiveAt(at),
    eq(professional.active, true),
  ];
  if (caseId) {
    conditions.push(
      eq(caseAssignment.caseId, caseId),
      isNull(caseAssignment.endedAt),
    );
  }
  const query = db
    .selectDistinct({ professionalId: professional.professionalId })
    .from(professional)
    .innerJoin(personAffiliation, eq(personAffiliation.personId, professional.personId));
  const rows = caseId
    ? await query
        .innerJoin(caseAssignment, eq(caseAssignment.professionalId, professional.professionalId))
        .where(and(...conditions))
    : await query.where(and(...conditions));
  return rows.map((row) => row.professionalId);
}

export async function billableProfessionalIds(
  db: DatabaseOrTransaction,
  actor: PortalActor,
  caseId: string,
): Promise<string[]> {
  const ids = new Set(await representedProfessionalIds(db, actor.userAccountId, caseId));
  if (actor.professionalId) {
    const [own] = await db
      .select({ id: caseAssignment.caseAssignmentId })
      .from(caseAssignment)
      .where(
        and(
          eq(caseAssignment.caseId, caseId),
          eq(caseAssignment.professionalId, actor.professionalId),
          isNull(caseAssignment.endedAt),
        ),
      );
    if (own) {
      ids.add(actor.professionalId);
    }
  }
  return [...ids];
}
