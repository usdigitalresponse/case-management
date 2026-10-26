// Who a portal user may act for: themselves, as a delegate the active
// professionals in their office (model/rules.yaml
// authorize_delegated_submission), and as staff any professional on the
// case (authorize_staff_invoice_entry). Either way the professional must be
// assigned to the case.
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseAssignment, personAffiliation, professional, userAccount } from '../db/schema';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
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

// An active account with a staff role may enter requests received outside
// the system for any professional on a case.
export async function isStaffAccount(db: DatabaseOrTransaction, userAccountId: string): Promise<boolean> {
  const staffRoleIds = await getStaffAccountRoleIds(db);
  if (staffRoleIds.length === 0) {
    return false;
  }
  const [row] = await db
    .select({ id: userAccount.userAccountId })
    .from(userAccount)
    .where(
      and(
        eq(userAccount.userAccountId, userAccountId),
        eq(userAccount.active, true),
        inArray(userAccount.systemRoleId, staffRoleIds),
      ),
    );
  return Boolean(row);
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

// Active professionals assigned to the case, or to any open assignment.
async function assignedProfessionalIds(db: DatabaseOrTransaction, caseId?: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ professionalId: professional.professionalId })
    .from(professional)
    .innerJoin(caseAssignment, eq(caseAssignment.professionalId, professional.professionalId))
    .where(
      and(
        eq(professional.active, true),
        isNull(caseAssignment.endedAt),
        ...(caseId ? [eq(caseAssignment.caseId, caseId)] : []),
      ),
    );
  return rows.map((row) => row.professionalId);
}

// The professionals a user acts for besides themselves: everyone assigned
// for staff, else the office's professionals for a delegate.
export async function representedProfessionalIds(
  db: DatabaseOrTransaction,
  userAccountId: string,
  caseId?: string,
  at: Date = new Date(),
): Promise<string[]> {
  if (await isStaffAccount(db, userAccountId)) {
    return assignedProfessionalIds(db, caseId);
  }
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

// Whose time on a case the user may read: their own, and that of the
// professionals they act for who are assigned to it.
export async function timeReadableProfessionalIds(
  db: DatabaseOrTransaction,
  actor: PortalActor,
  caseId: string,
): Promise<string[]> {
  const represented = await representedProfessionalIds(db, actor.userAccountId, caseId);
  return [...new Set([...(actor.professionalId ? [actor.professionalId] : []), ...represented])];
}
