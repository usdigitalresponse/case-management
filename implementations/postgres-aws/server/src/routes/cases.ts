import { Router } from 'express';
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
  invoice,
  invoiceStatuses,
  caseStatuses,
  role,
} from '../db/schema';
import { createCase, CreateCaseValidationError, CreateCaseConfigurationError } from '../intake/createCase';
import { caseStageExpression } from '../cases/caseStage';
import { getSessionUser, requireFullUser } from '../auth/session';
import { getExternalSubmitterRoleId } from '../professionals/externalSubmitterRole';
import { assignProfessionalToCase, AlreadyAssignedError } from '../cases/assignProfessionalToCase';
import { assignStaffToCase, NotStaffAccountError } from '../cases/assignStaffToCase';
import { CaseNotFoundError } from '../cases/errors';
import { closeCase, CloseCaseValidationError, CaseAlreadyClosedError, CloseCaseConfigurationError } from '../cases/closeCase';
import { asyncHandler } from './asyncHandler';

const router = Router();
// Full staff access only: external (magic-link) users get their own
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

// Scoped specifically to assigning an external (magic-link) professional
// to a case with the "External Submitter" role - not a general-purpose
// assignment endpoint (staff assignment, role choice, qualification/
// workload checks are all out of scope here; see
// ../professionals/externalSubmitterRole.ts and ../../MAPPING.md).
router.post(
  '/:id/external-assignments',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const caseId = req.params.id as string;
    const professionalId = typeof req.body?.professionalId === 'string' ? req.body.professionalId : undefined;
    if (!professionalId) {
      res.status(400).json({ error: 'validation_error', message: 'professionalId is required.' });
      return;
    }

    const [[caseRow], [professionalRow]] = await Promise.all([
      db.select({ caseId: caseTable.caseId }).from(caseTable).where(eq(caseTable.caseId, caseId)),
      db
        .select({ professionalId: professional.professionalId })
        .from(professional)
        .where(eq(professional.professionalId, professionalId)),
    ]);
    if (!caseRow) {
      res.status(404).json({ error: 'not_found', message: 'Case not found.' });
      return;
    }
    if (!professionalRow) {
      res.status(400).json({ error: 'validation_error', message: 'professionalId does not exist.' });
      return;
    }

    const assignmentRoleId = await getExternalSubmitterRoleId(db);
    try {
      const assignment = await assignProfessionalToCase(db, caseId, professionalId, assignmentRoleId, actor.userAccountId);
      res.status(201).json({ assignment });
    } catch (error) {
      if (error instanceof AlreadyAssignedError) {
        res.status(409).json({ error: 'already_assigned', message: error.message });
        return;
      }
      throw error;
    }
  }),
);

// Assigns a staff (SSO) user to a case — the internal-assignment
// counterpart to /:id/external-assignments above. Staff has no
// professional profile until their first assignment (unlike a vendor's,
// bootstrapped at magic-link login; see
// ../professionals/ensureProfessional.ts), so one is created lazily by
// ../cases/assignStaffToCase.ts, the first time they're assigned to
// anything.
router.post(
  '/:id/staff-assignments',
  asyncHandler(async (req, res) => {
    const actor = getSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const caseId = req.params.id as string;
    const userAccountId = typeof req.body?.userAccountId === 'string' ? req.body.userAccountId : undefined;
    if (!userAccountId) {
      res.status(400).json({ error: 'validation_error', message: 'userAccountId is required.' });
      return;
    }

    try {
      const assignment = await assignStaffToCase(db, actor.userAccountId, { caseId, userAccountId });
      res.status(201).json({ assignment });
    } catch (error) {
      if (error instanceof CaseNotFoundError) {
        res.status(404).json({ error: 'not_found', message: error.message });
        return;
      }
      if (error instanceof NotStaffAccountError) {
        res.status(400).json({ error: 'validation_error', message: error.message });
        return;
      }
      if (error instanceof AlreadyAssignedError) {
        res.status(409).json({ error: 'already_assigned', message: error.message });
        return;
      }
      throw error;
    }
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
    try {
      const result = await closeCase(db, actor.userAccountId, caseId, req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof CloseCaseValidationError) {
        res.status(400).json({ error: 'validation_error', fieldErrors: error.fieldErrors });
        return;
      }
      if (error instanceof CaseNotFoundError) {
        res.status(404).json({ error: 'not_found', message: error.message });
        return;
      }
      if (error instanceof CaseAlreadyClosedError) {
        res.status(409).json({ error: 'already_closed', message: error.message });
        return;
      }
      if (error instanceof CloseCaseConfigurationError) {
        res.status(500).json({ error: 'configuration_error', message: error.message });
        return;
      }
      throw error;
    }
  }),
);

// Viewing only, scoped to one case — the review action itself
// (approve/reject) lives on the cross-case queue, ../routes/invoices.ts,
// since reviewing isn't done case-by-case.
router.get(
  '/:id/invoices',
  asyncHandler(async (req, res) => {
    const caseId = req.params.id as string;
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
      .where(eq(invoice.caseId, caseId));
    res.json({ invoices: rows });
  }),
);

export default router;
