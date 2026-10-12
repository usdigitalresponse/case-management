// Administrator settings: the professional kinds whose rates price time
// (model/rules.yaml apply_professional_rates). Staff can read them; only
// administrators change them.
import { Router } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireFullUser } from '../auth/session';
import { requireAdmin } from '../auth/requireAdmin';
import { addKindRate, createKind, listKinds } from '../billing/professionalRates';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireFullUser);

router.get(
  '/professional-kinds',
  asyncHandler(async (_req, res) => {
    res.json({ kinds: await listKinds(db) });
  }),
);

router.post(
  '/professional-kinds',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createKind(db, req.body));
  }),
);

// Rates are added from a date, never edited.
router.post(
  '/professional-kinds/:id/rates',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.status(201).json(await addKindRate(db, user.userAccountId, req.params.id as string, req.body));
  }),
);

export default router;
