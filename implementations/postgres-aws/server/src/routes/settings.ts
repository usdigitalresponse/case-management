// Administrator settings: professional kinds and their rates, mileage rates,
// billing rules with their codes, review routing, staff roles and, on demo
// servers, demo tools. Staff can read most of them; only administrators
// change them, except their own role in the demo tools.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../db/client';
import { getSessionUser, requireFullUser } from '../auth/session';
import { requireAdmin } from '../auth/requireAdmin';
import { addKindRate, createKind, listKinds } from '../billing/professionalRates';
import { addMileageRate, listMileageRates } from '../billing/mileageRates';
import {
  addBillingCode,
  getBillingRules,
  listBillingCodes,
  setBillingCodeActive,
  setBillingRule,
} from '../billing/billingRules';
import { getReviewSettings, setReviewSettings } from '../billing/reviewSettings';
import { addDecisionReason, listDecisionReasons, updateDecisionReason } from '../billing/decisionReasons';
import {
  addStaffAccount,
  listStaffAccounts,
  listStaffRoles,
  setOwnDemoRole,
  setStaffActive,
  setStaffRole,
} from '../auth/staffAccountRole';
import { demoLoginEnabled } from '../auth/demoSettings';
import { resetToDemoData } from '../db/demoData';
import { documentStore } from '../imports/documentStore';
import { removeUnreferencedFiles } from '../imports/invoiceImports';
import { ConflictError, NotFoundError } from '../errors';
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
  '/mileage-rates',
  asyncHandler(async (_req, res) => {
    res.json({ rates: await listMileageRates(db) });
  }),
);

// Added from a date, never edited.
router.post(
  '/mileage-rates',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.status(201).json(await addMileageRate(db, user.userAccountId, req.body));
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

router.get(
  '/review',
  asyncHandler(async (_req, res) => {
    res.json(await getReviewSettings(db));
  }),
);

router.put(
  '/review',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.json(await setReviewSettings(db, user.userAccountId, req.body));
  }),
);

// Who uses this tool and in which role. Accounts are created on first
// sign-in from an allowed domain, or added here first; administrators
// change roles and deactivate accounts here.
router.get(
  '/staff-roles',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [roles, people] = await Promise.all([listStaffRoles(db), listStaffAccounts(db)]);
    res.json({ roles, people });
  }),
);

router.post(
  '/staff',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.status(201).json(await addStaffAccount(db, user.userAccountId, req.body));
  }),
);

router.put(
  '/staff/:userAccountId/active',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.json(await setStaffActive(db, user.userAccountId, req.params.userAccountId as string, req.body));
  }),
);

router.put(
  '/staff-roles/:userAccountId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.json(await setStaffRole(db, user.userAccountId, req.params.userAccountId as string, req.body));
  }),
);

// Reasons for approving a line in part or rejecting it. Retired reasons stay
// on the decisions that used them.
router.get(
  '/decision-reasons',
  asyncHandler(async (_req, res) => {
    res.json({ reasons: await listDecisionReasons(db) });
  }),
);

router.post(
  '/decision-reasons',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await addDecisionReason(db, req.body));
  }),
);

router.put(
  '/decision-reasons/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await updateDecisionReason(db, req.params.id as string, req.body));
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

// Demo tools, only where the staff demo sign-in is on.
function requireDemo(_req: Request, _res: Response, next: NextFunction): void {
  next(demoLoginEnabled ? undefined : new NotFoundError('Demo tools are off on this server.'));
}

// Any staff member, not only administrators, switches their own role.
router.get(
  '/demo/role',
  requireDemo,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    const [roles, people] = await Promise.all([listStaffRoles(db), listStaffAccounts(db)]);
    const me = people.find((person) => person.userAccountId === user.userAccountId);
    if (!me) {
      throw new NotFoundError('Only staff accounts have a role to change.');
    }
    res.json({ roles, roleId: me.roleId });
  }),
);

router.put(
  '/demo/role',
  requireDemo,
  asyncHandler(async (req, res) => {
    const user = getSessionUser(req)!;
    res.json(await setOwnDemoRole(db, user.userAccountId, req.body));
  }),
);

// Deletes everything, as `npm run seed` does, and recreates the synthetic
// demo data. Accounts are recreated, so the caller signs in again.
let resetting = false;
router.post(
  '/demo/reset',
  requireDemo,
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (resetting) {
      throw new ConflictError('reset_in_progress', 'A reset is already running.');
    }
    resetting = true;
    try {
      const summary = await resetToDemoData();
      await removeUnreferencedFiles(db, documentStore);
      req.session = null;
      res.json(summary);
    } finally {
      resetting = false;
    }
  }),
);

export default router;
