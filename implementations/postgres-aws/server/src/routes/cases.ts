import { Router } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import {
  caseTable,
  caseParticipant,
  caseLifecycleEvent,
  caseIdentifier,
  caseAssignment,
  professional,
  person,
  caseStatuses,
  county,
  role,
} from '../db/schema';
import { loadPreauthorizationSummaries, setPreauthorizedAmount } from '../billing/preauthorizations';
import { loadCaseRateViews } from '../billing/caseRates';
import { loadCaseReviewer, setCaseReviewer } from '../billing/reviewAssignment';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { createCase } from '../intake/createCase';
import { loadRecentCaseChanges } from '../cases/caseSummaries';
import { CASE_STAGES } from '../cases/caseStage';
import { caseColumnsWithClientName, caseCounts, caseOverview, CASE_SHOWS, listCaseBatch } from '../cases/caseBatches';
import { batchRequest } from '../lists/batches';
import { getSessionUser, requireFullUser } from '../auth/session';
import { assignExternalSubmitterToCase } from '../cases/assignExternalSubmitterToCase';
import { assignStaffToCase } from '../cases/assignStaffToCase';
import { closeCase, unfinishedInvoices } from '../cases/closeCase';
import { listPossibleDuplicateCases, recordCaseDuplicateReview } from '../cases/possibleDuplicateCases';
import { asyncHandler } from './asyncHandler';
import { ValidationError } from '../errors';
import { tagTourRecord } from '../demoTour/tourRuns';

const router = Router();
// Full staff access only: external (email-code) users get their own
// narrower endpoints (GET /api/my-cases, POST .../external-assignments
// only via a full user) rather than this general case list/detail API.
router.use(requireFullUser);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      // requireFullUser already guards this; satisfies the type checker.
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const result = await createCase(db, { userAccountId: actor.userAccountId }, req.body);
    await tagTourRecord(req, 'case', result.caseId);
    res.status(201).json(result);
  }),
);

// A batch of cases by client name, with its summary on the first (../cases/caseBatches.ts).
// show: all, open or closed; stage; county: an id, 'none' or 'grouped'; q: client, case number or worker.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const stage = CASE_STAGES.find((value) => value === req.query.stage);
    const county = req.query.county === undefined || req.query.county === '' ? undefined : String(req.query.county);
    if (county !== undefined && county !== 'none' && county !== 'grouped' && !z.uuid().safeParse(county).success) {
      throw new ValidationError({ county: 'That is not a county.' });
    }
    res.json(
      await listCaseBatch(
        db,
        {
          show: CASE_SHOWS.find((value) => value === req.query.show) ?? 'all',
          stage,
          county,
          q: typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined,
        },
        batchRequest(req.query),
      ),
    );
  }),
);

// Every case's counts: the sidebar's open cases and Organizations' cases each.
router.get(
  '/counts',
  asyncHandler(async (_req, res) => {
    res.json(await caseCounts(db));
  }),
);

// The Case overview's stages, each with its count and first few cases.
router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(await caseOverview(db));
  }),
);

// Any staff member: possible duplicate cases, and flagging or clearing a pair.
router.get(
  '/possible-duplicates',
  asyncHandler(async (_req, res) => {
    res.json({ duplicates: await listPossibleDuplicateCases(db) });
  }),
);

router.post(
  '/possible-duplicates',
  asyncHandler(async (req, res) => {
    await recordCaseDuplicateReview(db, getSessionUser(req)!.userAccountId, req.body);
    res.status(204).end();
  }),
);

// The latest changes across cases, for the case overview.
router.get(
  '/recent-changes',
  asyncHandler(async (_req, res) => {
    res.json({ changes: await loadRecentCaseChanges(db) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Express guarantees `id` is present for a matched `:id` route;
    // noUncheckedIndexedAccess just can't see that.
    const caseId = req.params.id as string;
    const [caseRow] = await db
      .select(caseColumnsWithClientName)
      .from(caseTable)
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
      .leftJoin(county, eq(caseTable.countyId, county.countyId))
      .where(eq(caseTable.caseId, caseId));
    if (!caseRow) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const resultingStatuses = alias(caseStatuses, 'resulting_statuses');
    const [participants, lifecycleEvents, identifiers, assignments, unfinished] = await Promise.all([
      db
        .select({
          caseParticipantId: caseParticipant.caseParticipantId,
          caseId: caseParticipant.caseId,
          personId: caseParticipant.personId,
          personDisplayName: person.displayName,
          participantRoleId: caseParticipant.participantRoleId,
          participantRoleDisplayName: role.displayName,
          affiliationId: caseParticipant.affiliationId,
          startedAt: caseParticipant.startedAt,
          endedAt: caseParticipant.endedAt,
        })
        .from(caseParticipant)
        .leftJoin(person, eq(caseParticipant.personId, person.personId))
        .leftJoin(role, eq(caseParticipant.participantRoleId, role.roleId))
        .where(eq(caseParticipant.caseId, caseId)),
      db
        .select({
          caseLifecycleEventId: caseLifecycleEvent.caseLifecycleEventId,
          caseId: caseLifecycleEvent.caseId,
          sequenceNumber: caseLifecycleEvent.sequenceNumber,
          eventTypeId: caseLifecycleEvent.eventTypeId,
          resultingStatusId: caseLifecycleEvent.resultingStatusId,
          resultingStatusDisplayName: resultingStatuses.displayName,
          effectiveAt: caseLifecycleEvent.effectiveAt,
          recordedAt: caseLifecycleEvent.recordedAt,
          actorUserAccountId: caseLifecycleEvent.actorUserAccountId,
          reasonId: caseLifecycleEvent.reasonId,
          reasonDetail: caseLifecycleEvent.reasonDetail,
          referenceNumber: caseLifecycleEvent.referenceNumber,
          correctsEventId: caseLifecycleEvent.correctsEventId,
        })
        .from(caseLifecycleEvent)
        .leftJoin(resultingStatuses, eq(caseLifecycleEvent.resultingStatusId, resultingStatuses.id))
        .where(eq(caseLifecycleEvent.caseId, caseId))
        .orderBy(asc(caseLifecycleEvent.sequenceNumber)),
      db.select().from(caseIdentifier).where(eq(caseIdentifier.caseId, caseId)),
      db
        .select({
          caseAssignmentId: caseAssignment.caseAssignmentId,
          caseId: caseAssignment.caseId,
          professionalId: caseAssignment.professionalId,
          professionalDisplayName: professional.displayName,
          assignmentRoleId: caseAssignment.assignmentRoleId,
          assignmentRoleDisplayName: role.displayName,
          assignedAt: caseAssignment.assignedAt,
          endedAt: caseAssignment.endedAt,
        })
        .from(caseAssignment)
        .leftJoin(professional, eq(caseAssignment.professionalId, professional.professionalId))
        .leftJoin(role, eq(caseAssignment.assignmentRoleId, role.roleId))
        .where(eq(caseAssignment.caseId, caseId))
        .orderBy(asc(caseAssignment.assignedAt)),
      unfinishedInvoices(db, caseId),
    ]);
    res.json({ case: caseRow, participants, lifecycleEvents, identifiers, assignments, unfinishedInvoices: unfinished });
  }),
);

// The two assignment workflows (../cases/assignExternalSubmitterToCase.ts,
// ../cases/assignStaffToCase.ts), both built on
// ../cases/assignProfessionalToCase.ts.
router.post(
  '/:id/external-assignments',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const assignment = await assignExternalSubmitterToCase(db, actor.userAccountId, req.params.id as string, req.body);
    res.status(201).json({ assignment });
  }),
);

router.post(
  '/:id/staff-assignments',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const assignment = await assignStaffToCase(db, actor.userAccountId, req.params.id as string, req.body);
    res.status(201).json({ assignment });
  }),
);

// Closes a case — ends every open assignment and records the closing
// lifecycle event atomically (../cases/closeCase.ts).
router.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const caseId = req.params.id as string;
    const result = await closeCase(db, actor.userAccountId, caseId, req.body);
    res.json(result);
  }),
);

// The case's submitted invoices, with who has each and what was approved,
// and its pre-authorizations, case rates and invoice reviewer. Review itself
// happens on the invoice page (../routes/invoices.ts).
router.get(
  '/:id/invoices',
  asyncHandler(async (req, res) => {
    const caseId = req.params.id as string;
    if (!z.uuid().safeParse(caseId).success) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Its invoices themselves come a batch at a time from GET /api/invoices?caseId=.
    const [preauthorizations, caseRates, reviewer, numbers] = await Promise.all([
      loadPreauthorizationSummaries(db, caseId),
      loadCaseRateViews(db, caseId),
      loadCaseReviewer(db, caseId),
      loadCaseNumbers(db, [caseId]),
    ]);
    res.json({
      preauthorizations,
      caseRates,
      reviewer,
      caseNumber: numbers.get(caseId)?.caseNumber ?? null,
      otherCaseNumbers: numbers.get(caseId)?.otherNumbers ?? [],
    });
  }),
);

// Any staff member enters or changes a pre-authorized amount.
router.post(
  '/:id/preauthorizations',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req)!;
    res.status(201).json(await setPreauthorizedAmount(db, actor.userAccountId, req.params.id as string, req.body));
  }),
);

// Where this case's new invoices go, ahead of the default in Settings.
router.put(
  '/:id/invoice-reviewer',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req)!;
    res.json(await setCaseReviewer(db, actor.userAccountId, req.params.id as string, req.body));
  }),
);

export default router;
