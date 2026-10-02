// Lists the cases the current session's professional profile is actively
// assigned to - the external (magic-link) user's entry point into "which
// cases can I submit time/invoices for" (see model/schema.yaml
// case_assignment). Works the same way for a full (SSO) user once they
// have a professional profile, though nothing currently creates one for
// that login path (see ../professionals/ensureProfessional.ts).
import { Router } from 'express';
import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../db/client';
import { caseAssignment, caseTable } from '../db/schema';
import { getSessionUser, requireAuth } from '../auth/session';
import { getProfessionalIdForUserAccount } from '../professionals/ensureProfessional';
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
    if (!professionalId) {
      res.json({ cases: [] });
      return;
    }

    const rows = await db
      .select({
        caseId: caseTable.caseId,
        statusId: caseTable.statusId,
        externalReference: caseTable.externalReference,
        assignedAt: caseAssignment.assignedAt,
      })
      .from(caseAssignment)
      .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
      .where(and(eq(caseAssignment.professionalId, professionalId), isNull(caseAssignment.endedAt)));
    res.json({ cases: rows });
  }),
);

export default router;
