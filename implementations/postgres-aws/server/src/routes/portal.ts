// Time/invoice submission for the external portal. requireAuth only (not
// requireFullUser) — intentionally usable by any authenticated session
// with a professional profile, external or staff, since nothing about
// logging your own time is staff-exclusive. A session with no
// professional profile yet (every magic-link login gets one; an SSO
// login currently doesn't — see ../professionals/ensureProfessional.ts)
// gets a 404 rather than empty results, so the client can tell "you have
// no profile" apart from "you have no time entries."
import { Router, type Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { timeEntry, invoice, invoiceStatuses } from '../db/schema';
import { getSessionUser, requireAuth } from '../auth/session';
import { getProfessionalIdForUserAccount } from '../professionals/ensureProfessional';
import { createTimeEntry } from '../portal/createTimeEntry';
import { createInvoice } from '../portal/createInvoice';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireAuth);

interface PortalActor {
  userAccountId: string;
  professionalId: string;
}

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

router.post(
  '/time-entries',
  asyncHandler(async (req, res) => {
    const actor = await resolvePortalActor(req);
    if (!actor) {
      res.status(404).json({ error: 'no_professional_profile' });
      return;
    }
    const result = await createTimeEntry(db, { professionalId: actor.professionalId }, req.body);
    res.status(201).json(result);
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
    const result = await createInvoice(db, actor, req.body);
    res.status(201).json(result);
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
      .select({
        invoiceId: invoice.invoiceId,
        caseId: invoice.caseId,
        statusId: invoice.statusId,
        statusDisplayName: invoiceStatuses.displayName,
        submittedAt: invoice.submittedAt,
        submittedTotal: invoice.submittedTotal,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
      })
      .from(invoice)
      .leftJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(and(...conditions));
    res.json({ invoices: rows });
  }),
);

export default router;
