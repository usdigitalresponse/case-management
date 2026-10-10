// Cases the session's professional profile, or anyone it acts for as a
// delegate, is actively assigned to: the external user's entry point. A full
// (SSO) user has no profile unless one is created
// (../professionals/ensureProfessional.ts).
import { Router } from 'express';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { caseAssignment, caseTable, caseStatuses, person } from '../db/schema';
import { getSessionUser, requireAuth } from '../auth/session';
import { getProfessionalIdForUserAccount } from '../professionals/ensureProfessional';
import { representedProfessionalIds } from '../portal/portalActor';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const professionalId = await getProfessionalIdForUserAccount(db, actor.userAccountId);
    const professionalIds = [
      ...(professionalId ? [professionalId] : []),
      ...(await representedProfessionalIds(db, actor.userAccountId)),
    ];
    if (professionalIds.length === 0) {
      res.json({ cases: [] });
      return;
    }

    const rows = await db
      .select({
        caseId: caseTable.caseId,
        statusId: caseTable.statusId,
        statusDisplayName: caseStatuses.displayName,
        externalReference: caseTable.externalReference,
        // The submitter is doing work for this client — showing the name is the point, not a leak.
        clientDisplayName: person.displayName,
        assignedAt: caseAssignment.assignedAt,
      })
      .from(caseAssignment)
      .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
      .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .where(and(inArray(caseAssignment.professionalId, professionalIds), isNull(caseAssignment.endedAt)))
      .orderBy(asc(caseAssignment.assignedAt));
    // One row per case, from its earliest open assignment among them.
    const byCase = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!byCase.has(row.caseId)) {
        byCase.set(row.caseId, row);
      }
    }
    res.json({ cases: [...byCase.values()] });
  }),
);

export default router;
