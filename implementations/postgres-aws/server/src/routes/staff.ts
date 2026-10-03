// Lets a full user search for another staff member to assign to a case
// (../routes/cases.ts POST /:id/staff-assignments) — the staff-side
// counterpart to ../routes/professionals.ts's vendor search. "Staff" means
// a user_account created through SSO login, marked by
// ../auth/staffAccountRole.ts's role at account-creation time; a vendor's
// magic-link account never gets that role, so it's excluded here even
// though both live in the same user_account table.
import { Router } from 'express';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db/client';
import { userAccount } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { getStaffAccountRoleId } from '../auth/staffAccountRole';
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
    const staffAccountRoleId = await getStaffAccountRoleId(db);
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
          eq(userAccount.systemRoleId, staffAccountRoleId),
          or(ilike(userAccount.displayName, pattern), ilike(userAccount.email, pattern)),
        ),
      )
      .orderBy(asc(userAccount.displayName))
      .limit(20);
    res.json({ staff: matches });
  }),
);

export default router;
