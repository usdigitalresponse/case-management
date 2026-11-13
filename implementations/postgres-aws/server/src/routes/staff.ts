// Staff search, to assign one to a case: accounts with a staff role (../auth/staffAccountRole.ts).
import { Router } from 'express';
import { and, asc, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../db/client';
import { userAccount } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ staff: [] });
      return;
    }
    const pattern = `%${q}%`;
    const staffAccountRoleIds = await getStaffAccountRoleIds(db);
    const matches = await db
      .select({
        userAccountId: userAccount.userAccountId,
        displayName: userAccount.displayName,
        email: userAccount.email,
        active: userAccount.active,
      })
      .from(userAccount)
      .where(
        and(
          inArray(userAccount.systemRoleId, staffAccountRoleIds),
          or(ilike(userAccount.displayName, pattern), ilike(userAccount.email, pattern)),
        ),
      )
      .orderBy(asc(userAccount.displayName))
      .limit(20);
    res.json({ staff: matches });
  }),
);

export default router;
