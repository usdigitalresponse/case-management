import { Router } from 'express';
import { and, asc, eq, type SQL } from 'drizzle-orm';
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
  CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT,
} from '../db/schema';
import { createCase, CreateCaseValidationError, CreateCaseConfigurationError } from '../intake/createCase';
import { getSessionUser, requireFullUser } from '../auth/session';
import { getExternalSubmitterRoleId } from '../professionals/externalSubmitterRole';
import { uniqueViolationConstraint } from '../db/rowHelpers';
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
  openedOn: caseTable.openedOn,
  closedOn: caseTable.closedOn,
  organizationId: caseTable.organizationId,
  officeId: caseTable.officeId,
  jurisdictionId: caseTable.jurisdictionId,
  preferredLanguageId: caseTable.preferredLanguageId,
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
      .where(eq(caseTable.caseId, caseId));
    if (!caseRow) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const [participants, lifecycleEvents, identifiers] = await Promise.all([
      db
        .select({
          caseParticipantId: caseParticipant.caseParticipantId,
          caseId: caseParticipant.caseId,
          personId: caseParticipant.personId,
          personDisplayName: person.displayName,
          participantRoleId: caseParticipant.participantRoleId,
          affiliationId: caseParticipant.affiliationId,
          startedAt: caseParticipant.startedAt,
          endedAt: caseParticipant.endedAt,
        })
        .from(caseParticipant)
        .leftJoin(person, eq(caseParticipant.personId, person.personId))
        .where(eq(caseParticipant.caseId, caseId)),
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
    let assignment;
    try {
      [assignment] = await db
        .insert(caseAssignment)
        .values({
          caseId,
          professionalId,
          assignedAt: new Date(),
          assignmentRoleId,
          assignedByUserAccountId: actor.userAccountId,
        })
        .returning();
    } catch (error) {
      // A double-click/retry collides with case_assignment_open_unique
      // (../db/schema.ts) rather than creating a second open assignment.
      if (uniqueViolationConstraint(error) === CASE_ASSIGNMENT_OPEN_UNIQUE_CONSTRAINT) {
        res.status(409).json({ error: 'already_assigned', message: 'Already assigned to this case.' });
        return;
      }
      throw error;
    }
    res.status(201).json({ assignment });
  }),
);

// Viewing only — approving/rejecting a submitted invoice needs
// invoice_approval_chain, a separate future pass (see ../../MAPPING.md).
router.get(
  '/:id/invoices',
  asyncHandler(async (req, res) => {
    const caseId = req.params.id as string;
    const rows = await db.select().from(invoice).where(eq(invoice.caseId, caseId));
    res.json({ invoices: rows });
  }),
);

export default router;
