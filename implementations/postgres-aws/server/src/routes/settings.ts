// Administrator settings: professional kinds and their rates, and billing
// rules with their codes. Staff can read them; only administrators change them.
import { Router } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireFullUser } from '../auth/session';
import { requireAdmin } from '../auth/requireAdmin';
import { addKindRate, createKind, listKinds } from '../billing/professionalRates';
import {
  addBillingCode,
  getBillingRules,
  listBillingCodes,
  setBillingCodeActive,
  setBillingRule,
} from '../billing/billingRules';
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

router.get(
  '/billing-rules',
  asyncHandler(async (_req, res) => {
    res.json({ rules: await getBillingRules(db), codes: await listBillingCodes(db) });
  }),
);

router.put(
  '/billing-rules/:code',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.json(await setBillingRule(db, user.userAccountId, req.params.code as string, req.body));
  }),
);

router.post(
  '/billing-codes',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await addBillingCode(db, req.body));
  }),
);

// Retired codes stay for invoices that used them.
router.put(
  '/billing-codes/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await setBillingCodeActive(db, req.params.id as string, req.body));
  }),
);

export default router;
