// Settings, Edit data: administrators fix cases added by mistake (../cases/caseCorrections.ts).
import { Router } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireFullUser } from '../auth/session';
import { requireAdmin } from '../auth/requireAdmin';
import { fixCase, listAddedCases, listCaseFixes, previewCaseFix, undoCaseFix } from '../cases/caseCorrections';
import { forgetDuplicateGroups } from '../duplicateCounts';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser, requireAdmin);

// show: added (default) or similar, those with a close number on another case in their county.
router.get(
  '/cases',
  asyncHandler(async (req, res) => {
    res.json({ cases: await listAddedCases(db, { similarOnly: req.query.show === 'similar' }) });
  }),
);

router.post(
  '/cases/preview',
  asyncHandler(async (req, res) => {
    res.json(await previewCaseFix(db, req.body));
  }),
);

router.get(
  '/fixes',
  asyncHandler(async (_req, res) => {
    res.json({ fixes: await listCaseFixes(db) });
  }),
);

router.post(
  '/fixes',
  asyncHandler(async (req, res) => {
    const fixed = await fixCase(db, getSessionUser(req)!.userAccountId, req.body);
    forgetDuplicateGroups('cases');
    res.status(201).json(fixed);
  }),
);

router.post(
  '/fixes/:id/undo',
  asyncHandler(async (req, res) => {
    const undone = await undoCaseFix(db, getSessionUser(req)!.userAccountId, req.params.id as string);
    forgetDuplicateGroups('cases');
    res.json(undone);
  }),
);

export default router;
