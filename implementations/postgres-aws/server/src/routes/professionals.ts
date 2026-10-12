// Two uses: finding the professional profile behind an external user's
// email so a full user can assign it to a case (see ../routes/cases.ts
// POST /:id/external-assignments — only a professional with
// userAccountId set is findable this way, i.e. every magic-link user,
// bootstrapped by ../professionals/ensureProfessional.ts on first login),
// and the sidebar's "Vendors" directory, which lists everyone rather
// than requiring a query first (professional is a small enough table for
// that, unlike ../routes/people.ts's person search), with each one's kind
// and that kind's rates. Administrators set the kind here.
//
// `professional` also backs internal staff assignment
// (../cases/assignStaffToCase.ts lazily creates one on first assignment),
// so a plain join would list staff as "vendors" too — excluded below by
// the same staff-account system roles ../routes/staff.ts filters on.
import { Router } from 'express';
import { and, eq, ilike, isNull, notInArray, or } from 'drizzle-orm';
import { db } from '../db/client';
import { professional, professionalKinds, userAccount } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { requireAdmin } from '../auth/requireAdmin';
import { listRates, setProfessionalKind } from '../billing/professionalRates';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const staffAccountRoleIds = await getStaffAccountRoleIds(db);
    // userAccount.systemRoleId is NULL for every vendor account — plain
    // `not in` would exclude those too (SQL's three-valued logic), so NULL
    // must be allowed through explicitly.
    const filters = [or(isNull(userAccount.systemRoleId), notInArray(userAccount.systemRoleId, staffAccountRoleIds))!];
    if (q) {
      filters.push(or(ilike(userAccount.email, `%${q}%`), ilike(professional.displayName, `%${q}%`))!);
    }
    const matches = await db
      .select({
        professionalId: professional.professionalId,
        displayName: professional.displayName,
        active: professional.active,
        email: userAccount.email,
        professionalKindId: professional.professionalKindId,
        professionalKindDisplayName: professionalKinds.displayName,
      })
      .from(professional)
      .innerJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
      .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
      .where(and(...filters))
      .limit(50);
    const rates = await listRates(
      db,
      matches.map((match) => match.professionalId),
    );
    res.json({
      professionals: matches.map((match) => ({
        ...match,
        rates: rates
          .filter((rate) => rate.professionalId === match.professionalId)
          .map(({ hourlyRate, effectiveFrom }) => ({ hourlyRate, effectiveFrom })),
      })),
    });
  }),
);

// Which kind's rates price this professional's time (model/rules.yaml
// apply_professional_rates). Null clears it.
router.put(
  '/:id/kind',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await setProfessionalKind(db, req.params.id as string, req.body));
  }),
);

export default router;
