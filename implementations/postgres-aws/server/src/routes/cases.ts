import { Router } from 'express';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { caseTable, caseParticipant, caseLifecycleEvent, caseIdentifier } from '../db/schema';
import { createCase, CreateCaseValidationError, CreateCaseConfigurationError } from '../intake/createCase';
import { getSessionUser, requireAuth } from '../auth/session';
import { asyncHandler } from './asyncHandler';

const router = Router();
router.use(requireAuth);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      // requireAuth already guards this; satisfies the type checker.
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    try {
      const result = await createCase(db, { userAccountId: actor.userAccountId }, req.body);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof CreateCaseValidationError) {
        res.status(400).json({ error: 'validation_error', fieldErrors: error.fieldErrors });
        return;
      }
      if (error instanceof CreateCaseConfigurationError) {
        res.status(500).json({ error: 'configuration_error', message: error.message });
        return;
      }
      throw error;
    }
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters: SQL[] = [];
    if (typeof req.query.countyId === 'string') {
      filters.push(eq(caseTable.countyId, req.query.countyId));
    }
    if (typeof req.query.statusId === 'string') {
      filters.push(eq(caseTable.statusId, req.query.statusId));
    }
    if (typeof req.query.caseCategoryId === 'string') {
      filters.push(eq(caseTable.caseCategoryId, req.query.caseCategoryId));
    }

    const rows = await db
      .select()
      .from(caseTable)
      .where(filters.length > 0 ? and(...filters) : undefined);
    res.json({ cases: rows });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Express guarantees `id` is present for a matched `:id` route;
    // noUncheckedIndexedAccess just can't see that.
    const caseId = req.params.id as string;
    const [caseRow] = await db.select().from(caseTable).where(eq(caseTable.caseId, caseId));
    if (!caseRow) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const [participants, lifecycleEvents, identifiers] = await Promise.all([
      db.select().from(caseParticipant).where(eq(caseParticipant.caseId, caseId)),
      db
        .select()
        .from(caseLifecycleEvent)
        .where(eq(caseLifecycleEvent.caseId, caseId))
        .orderBy(asc(caseLifecycleEvent.sequenceNumber)),
      db.select().from(caseIdentifier).where(eq(caseIdentifier.caseId, caseId)),
    ]);
    res.json({ case: caseRow, participants, lifecycleEvents, identifiers });
  }),
);

export default router;
