// Two uses: finding the professional profile behind an external user's
// email so a full user can assign it to a case (see ../routes/cases.ts
// POST /:id/external-assignments — only a professional with
// userAccountId set is findable this way, i.e. every magic-link user,
// bootstrapped by ../professionals/ensureProfessional.ts on first login),
// and the sidebar's "Vendors" directory, which lists everyone rather
// than requiring a query first (professional is a small enough table for
// that, unlike ../routes/people.ts's person search).
//
// `professional` also backs internal staff assignment
// (../cases/assignStaffToCase.ts lazily creates one on first assignment),
// so a plain join would list staff as "vendors" too — excluded below by
// the same staff-account system role ../routes/staff.ts filters on.
import { Router } from 'express';
import { and, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import { db } from '../db/client';
import { professional, userAccount } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { getStaffAccountRoleId } from '../auth/staffAccountRole';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const staffAccountRoleId = await getStaffAccountRoleId(db);
    // userAccount.systemRoleId is NULL for every vendor account — plain
    // `ne` would exclude those too (SQL's three-valued logic: NULL <> x
    // is NULL, not true), so NULL must be allowed through explicitly.
    const filters = [or(isNull(userAccount.systemRoleId), ne(userAccount.systemRoleId, staffAccountRoleId))!];
    if (q) {
      filters.push(or(ilike(userAccount.email, `%${q}%`), ilike(professional.displayName, `%${q}%`))!);
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
      .where(and(...filters))
      .limit(50);
    res.json({ professionals: matches });
  }),
);

export default router;
