// Existing-person search for the intake form (person creation is out of
// scope for this implementation slice — see ../../MAPPING.md). Since no
// person is ever created here, model/rules.yaml's
// flag_possible_duplicate_client (which triggers before_create on person)
// does not apply to this endpoint.
import { Router } from 'express';
import { ilike, or } from 'drizzle-orm';
import { db } from '../db/client';
import { person } from '../db/schema';
import { requireFullUser } from '../auth/session';
import { asyncHandler } from './asyncHandler';

const router = Router();
// Full staff access only — the person directory isn't something an
// external (magic-link) user should be able to search.
router.use(requireFullUser);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ people: [] });
      return;
    }
    const pattern = `%${q}%`;
    const matches = await db
      .select()
      .from(person)
      .where(or(ilike(person.displayName, pattern), ilike(person.email, pattern)))
      .limit(20);
    res.json({ people: matches });
  }),
);

export default router;
