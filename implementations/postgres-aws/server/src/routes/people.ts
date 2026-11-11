// Staff only: person search, possible duplicate people
// (../people/possibleDuplicates.ts) and, for administrators, merging them
// (../people/personMerges.ts). Search never creates a person.
import { Router } from 'express';
import { and, ilike, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { person } from '../db/schema';
import { getSessionUser, requireFullUser } from '../auth/session';
import { requireAdmin } from '../auth/requireAdmin';
import { listPossibleDuplicates, recordDuplicateReview } from '../people/possibleDuplicates';
import { listMerges, mergePeople, previewMerge, undoMerges } from '../people/personMerges';
import { asyncHandler } from './asyncHandler';

const router = Router();
// Full staff access only — the person directory isn't something an
// external (email-code) user should be able to search.
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
      .where(and(or(ilike(person.displayName, pattern), ilike(person.email, pattern)), isNull(person.mergedIntoPersonId)))
      .limit(20);
    res.json({ people: matches });
  }),
);

router.get(
  '/possible-duplicates',
  asyncHandler(async (_req, res) => {
    res.json({ duplicates: await listPossibleDuplicates(db) });
  }),
);

// Any staff member: flag a pair, or record that they are different people.
router.post(
  '/possible-duplicates',
  asyncHandler(async (req, res) => {
    await recordDuplicateReview(db, getSessionUser(req)!.userAccountId, req.body);
    res.status(204).end();
  }),
);

// Any staff member may see what a merge would do; nothing is kept.
router.get(
  '/merge-preview',
  asyncHandler(async (req, res) => {
    const keep = typeof req.query.keep === 'string' ? req.query.keep : '';
    const retire = typeof req.query.retire === 'string' ? req.query.retire.split(',') : [];
    res.json(await previewMerge(db, getSessionUser(req)!.userAccountId, keep, retire));
  }),
);

router.get(
  '/merges',
  asyncHandler(async (_req, res) => {
    res.json({ merges: await listMerges(db) });
  }),
);

router.post(
  '/merges',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await mergePeople(db, getSessionUser(req)!.userAccountId, req.body));
  }),
);

router.post(
  '/merges/undo',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await undoMerges(db, getSessionUser(req)!.userAccountId, (req.body as { personMergeIds?: unknown }).personMergeIds));
  }),
);

export default router;
