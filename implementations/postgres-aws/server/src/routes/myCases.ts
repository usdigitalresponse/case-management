// The external user's case list (../portal/listPortalCases.ts). A full (SSO)
// user has no profile unless one is created
// (../professionals/ensureProfessional.ts).
import { Router } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireAuth } from '../auth/session';
import { listPortalCases } from '../portal/listPortalCases';
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
    res.json(await listPortalCases(db, actor.userAccountId));
  }),
);

export default router;
