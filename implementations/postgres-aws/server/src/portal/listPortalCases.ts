// Cases the user's own professional profile, or anyone they act for as a
// delegate, is actively assigned to: the external user's entry point. Each
// case lists which of those professionals hold it, so the portal can show a
// section per person; a case shared by several appears in each section.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { caseAssignment, caseTable, caseStatuses, person, professional } from '../db/schema';
import { representedProfessionalIds, resolvePortalActor } from './portalActor';

export interface PortalCaseProfessional {
  professionalId: string;
  displayName: string | null;
  isSelf: boolean;
}

export interface PortalCase {
  caseId: string;
  statusId: string;
  statusDisplayName: string | null;
  externalReference: string | null;
  clientDisplayName: string | null;
  // The earliest open assignment among the listed professionals.
  assignedAt: Date;
  assignedProfessionalIds: string[];
}

export async function listPortalCases(
  db: DatabaseOrTransaction,
  userAccountId: string,
): Promise<{ professionals: PortalCaseProfessional[]; cases: PortalCase[] }> {
  const actor = await resolvePortalActor(db, userAccountId);
  const representedIds = (await representedProfessionalIds(db, userAccountId)).filter(
    (id) => id !== actor.professionalId,
  );
  const professionalIds = [...(actor.professionalId ? [actor.professionalId] : []), ...representedIds];
  if (professionalIds.length === 0) {
    return { professionals: [], cases: [] };
  }

  const names = await db
    .select({ professionalId: professional.professionalId, displayName: professional.displayName })
    .from(professional)
    .where(inArray(professional.professionalId, professionalIds));
  // Yourself first, then the people you act for by name.
  const professionals = names
    .map((row) => ({ ...row, isSelf: row.professionalId === actor.professionalId }))
    .sort(
      (a, b) =>
        Number(b.isSelf) - Number(a.isSelf) || (a.displayName ?? '').localeCompare(b.displayName ?? ''),
    );

  const rows = await db
    .select({
      caseId: caseTable.caseId,
      statusId: caseTable.statusId,
      statusDisplayName: caseStatuses.displayName,
      externalReference: caseTable.externalReference,
      // The submitter is doing work for this client — showing the name is the point, not a leak.
      clientDisplayName: person.displayName,
      assignedAt: caseAssignment.assignedAt,
      professionalId: caseAssignment.professionalId,
    })
    .from(caseAssignment)
    .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
    .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(and(inArray(caseAssignment.professionalId, professionalIds), isNull(caseAssignment.endedAt)))
    .orderBy(asc(caseAssignment.assignedAt));
  const byCase = new Map<string, PortalCase>();
  for (const { professionalId, ...row } of rows) {
    const existing = byCase.get(row.caseId);
    if (!existing) {
      byCase.set(row.caseId, { ...row, assignedProfessionalIds: [professionalId] });
    } else if (!existing.assignedProfessionalIds.includes(professionalId)) {
      existing.assignedProfessionalIds.push(professionalId);
    }
  }
  return { professionals, cases: [...byCase.values()] };
}
