// Lets a full user find the professional profile behind an external user's
// email so they can assign it to a case (see ../routes/cases.ts
// POST /:id/external-assignments). Only a professional with userAccountId
// set is findable this way - that's every magic-link user (bootstrapped by
// ../professionals/ensureProfessional.ts on first login) - so an external
// vendor must log in via magic link once before they can be assigned.
import { Router } from 'express';
import { eq, ilike } from 'drizzle-orm';
import { db } from '../db/client';
import { professional, userAccount } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ professionals: [] });
      return;
    }
    const matches = await db
      .select({
        professionalId: professional.professionalId,
        displayName: professional.displayName,
        active: professional.active,
        email: userAccount.email,
      })
      .from(professional)
      .innerJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
      .where(ilike(userAccount.email, `%${q}%`))
      .limit(20);
    res.json({ professionals: matches });
  }),
);

export default router;
