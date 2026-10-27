import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, type SQL } from 'drizzle-orm';
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
  role,
} from '../db/schema';
import { listReviewQueue } from '../billing/reviewQueue';
import { loadPreauthorizationSummaries } from '../billing/preauthorizations';
import { loadCaseReviewer, setCaseReviewer } from '../billing/reviewAssignment';
import { loadCaseNumbers } from '../billing/invoiceDetail';
import { createCase } from '../intake/createCase';
import { caseStageExpression } from '../cases/caseStage';
import { getSessionUser, requireFullUser } from '../auth/session';
import { assignExternalSubmitterToCase } from '../cases/assignExternalSubmitterToCase';
import { assignStaffToCase } from '../cases/assignStaffToCase';
import { closeCase } from '../cases/closeCase';
import { asyncHandler } from './asyncHandler';

const router = Router();
// Full staff access only: external (email-code) users get their own
// narrower endpoints (GET /api/my-cases, POST .../external-assignments
// only via a full user) rather than this general case list/detail API.
router.use(requireFullUser);

// Shared between the list and detail routes below. clientDisplayName is
// joined in for display only (e.g. the case list's "Client" column) —
// client_id is a compatibility field, case_participant is authoritative
// (model/schema.yaml).
const caseColumnsWithClientName = {
  caseId: caseTable.caseId,
  clientId: caseTable.clientId,
  clientDisplayName: person.displayName,
  countyId: caseTable.countyId,
  externalReference: caseTable.externalReference,
  caseCategoryId: caseTable.caseCategoryId,
  statusId: caseTable.statusId,
  statusDisplayName: caseStatuses.displayName,
  openedOn: caseTable.openedOn,
  closedOn: caseTable.closedOn,
  organizationId: caseTable.organizationId,
  officeId: caseTable.officeId,
  jurisdictionId: caseTable.jurisdictionId,
  preferredLanguageId: caseTable.preferredLanguageId,
  stage: caseStageExpression,
};

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
    res.status(201).json(result);
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
      .select(caseColumnsWithClientName)
      .from(caseTable)
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
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
    const [caseRow] = await db
      .select(caseColumnsWithClientName)
      .from(caseTable)
      .leftJoin(person, eq(caseTable.clientId, person.personId))
      .leftJoin(caseStatuses, eq(caseTable.statusId, caseStatuses.id))
      .where(eq(caseTable.caseId, caseId));
    if (!caseRow) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const resultingStatuses = alias(caseStatuses, 'resulting_statuses');
    const [participants, lifecycleEvents, identifiers, assignments] = await Promise.all([
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
    ]);
    res.json({ case: caseRow, participants, lifecycleEvents, identifiers, assignments });
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
// and its pre-authorizations and invoice reviewer. Review itself happens on
// the invoice page (../routes/invoices.ts).
router.get(
  '/:id/invoices',
  asyncHandler(async (req, res) => {
    const caseId = req.params.id as string;
    if (!z.uuid().safeParse(caseId).success) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const [{ invoices: rows }, preauthorizations, reviewer, numbers] = await Promise.all([
      listReviewQueue(db, 'all', { caseId }),
      loadPreauthorizationSummaries(db, caseId),
      loadCaseReviewer(db, caseId),
      loadCaseNumbers(db, [caseId]),
    ]);
    rows.sort((a, b) => Number(b.submittedAt) - Number(a.submittedAt));
    res.json({
      invoices: rows,
      preauthorizations,
      reviewer,
      caseNumber: numbers.get(caseId)?.caseNumber ?? null,
      otherCaseNumbers: numbers.get(caseId)?.otherNumbers ?? [],
    });
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
