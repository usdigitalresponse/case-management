// Time/invoice submission for the external portal. requireAuth only (not
// requireFullUser) — intentionally usable by any authenticated session
// with a professional profile, external or staff, since nothing about
// logging your own time is staff-exclusive. A session with no
// professional profile yet (every magic-link login gets one; an SSO
// login currently doesn't — see ../professionals/ensureProfessional.ts)
// gets a 404 rather than empty results, so the client can tell "you have
// no profile" apart from "you have no time entries."
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { timeEntry, invoice } from '../db/schema';
import { getSessionUser, requireAuth } from '../auth/session';
import { getProfessionalIdForUserAccount } from '../professionals/ensureProfessional';
import {
  createTimeEntry,
  CreateTimeEntryValidationError,
  CreateTimeEntryConfigurationError,
} from '../portal/createTimeEntry';
import {
  createInvoice,
  CreateInvoiceValidationError,
  CreateInvoiceConfigurationError,
} from '../portal/createInvoice';
import { NotAssignedToCaseError } from '../portal/caseAssignmentAuthorization';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireAuth);

interface PortalActor {
  userAccountId: string;
  professionalId: string;
}

// One session lookup, not one per caller (requireProfessionalId used to
// re-derive the session user internally even when a handler had already
// read it for its own userAccountId).
async function resolvePortalActor(req: Request): Promise<PortalActor | undefined> {
  const actor = getSessionUser(req);
  if (!actor) {
    return undefined;
  }
  const professionalId = await getProfessionalIdForUserAccount(db, actor.userAccountId);
  if (!professionalId) {
    return undefined;
  }
  return { userAccountId: actor.userAccountId, professionalId };
}

// Shared instanceof-dispatch for the two createTimeEntry/createInvoice
// error sets, so each route's catch block is one line instead of
// repeating the same three-way if-chain. Returns false (caller rethrows)
// for anything it doesn't recognize.
function sendPortalError(res: Response, error: unknown): boolean {
  if (error instanceof NotAssignedToCaseError) {
    res.status(403).json({ error: 'not_assigned' });
    return true;
  }
  if (error instanceof CreateTimeEntryValidationError || error instanceof CreateInvoiceValidationError) {
    res.status(400).json({ error: 'validation_error', fieldErrors: error.fieldErrors });
    return true;
  }
  if (error instanceof CreateTimeEntryConfigurationError || error instanceof CreateInvoiceConfigurationError) {
    res.status(500).json({ error: 'configuration_error', message: error.message });
    return true;
  }
  return false;
}

router.post(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const actor = await resolvePortalActor(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    try {
      const result = await createTimeEntry(db, { professionalId: actor.professionalId }, req.body);
      res.status(201).json(result);
    } catch (error) {
      if (!sendPortalError(res, error)) {
        throw error;
      }
    }
  }),
);

router.get(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const actor = await resolvePortalActor(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    const conditions = [eq(timeEntry.professionalId, actor.professionalId)];
    if (caseId) {
      conditions.push(eq(timeEntry.caseId, caseId));
    }
    const rows = await db
      .select()
      .from(timeEntry)
      .where(and(...conditions));
    res.json({ timeEntries: rows });
  }),
);

router.post(
  '/invoices',
  asyncHandler(async (req, res) => {
    const actor = await resolvePortalActor(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    try {
      const result = await createInvoice(db, actor, req.body);
      res.status(201).json(result);
    } catch (error) {
      if (!sendPortalError(res, error)) {
        throw error;
      }
    }
  }),
);

router.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const actor = await resolvePortalActor(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
    const conditions = [eq(invoice.professionalId, actor.professionalId)];
    if (caseId) {
      conditions.push(eq(invoice.caseId, caseId));
    }
    const rows = await db
      .select()
      .from(invoice)
      .where(and(...conditions));
    res.json({ invoices: rows });
  }),
);

export default router;
