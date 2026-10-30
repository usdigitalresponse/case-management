// Intake for model/forms.yaml:new_case; all writes share one transaction.
import { eq, and, sql } from 'drizzle-orm';
import type { PgTable, AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client';
import { firstRow, uniqueViolationConstraint } from '../db/rowHelpers';
import { getReferenceId } from '../db/referenceLookups';
import { ValidationError } from '../errors';
import { calendarDateInReportingTimeZone } from '../reportingTimeZone';
import {
  caseTable,
  caseParticipant,
  caseLifecycleEvent,
  caseLifecycleEventTypes,
  caseIdentifier,
  caseStatuses,
  caseCategories,
  county,
  organization,
  office,
  jurisdictions,
  languages,
  caseIdentifierTypes,
  person,
  role,
  intakeRequest,
  CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT,
  INTAKE_REQUEST_PRIMARY_KEY_CONSTRAINT,
} from '../db/schema';
import {
  createCaseInputSchema,
  fieldErrorsFromZodIssues,
  type CreateCaseInput,
} from './validation';
import { emailInUse } from '../people/emails';

export type { CreateCaseInput, CreateCaseIdentifierInput } from './validation';

// Server-selected synthetic opening event type; see MAPPING.md.
const OPENING_EVENT_TYPE_CODE = 'sample_open';

// A new client sharing an email with someone, or a name unless confirmed
// as someone else, is a probable duplicate: refused, never merged.
async function probableDuplicatePerson(
  db: Database,
  client: { displayName: string; email?: string; confirmedNew: boolean },
): Promise<string | null> {
  if (client.email && (await emailInUse(db, client.email, 'any'))) {
    return 'Someone with this email is already in the system. Choose them instead.';
  }
  if (!client.confirmedNew) {
    const [sameName] = await db
      .select({ id: person.personId })
      .from(person)
      .where(sql`lower(trim(${person.displayName})) = ${client.displayName.toLowerCase()}`)
      .limit(1);
    if (sameName) {
      return `Someone named ${client.displayName} is already in the system. Choose them instead, or confirm this is someone else.`;
    }
  }
  return null;
}

async function existingCaseNumber(db: Database, caseNumber: string): Promise<string | null> {
  const wanted = caseNumber.toLowerCase();
  const [byReference] = await db.select({ id: caseTable.caseId }).from(caseTable).where(sql`lower(${caseTable.externalReference}) = ${wanted}`).limit(1);
  const [byIdentifier] = byReference
    ? [byReference]
    : await db.select({ id: caseIdentifier.caseId }).from(caseIdentifier).where(sql`lower(${caseIdentifier.value}) = ${wanted}`).limit(1);
  return byIdentifier ? `Case ${caseNumber} is already in the system. Choose it instead.` : null;
}

export interface CreateCaseActor {
  userAccountId: string;
}

export interface CreateCaseResult {
  caseId: string;
  caseParticipantId: string;
  caseLifecycleEventId: string;
  caseIdentifierId: string | null;
}

async function findExistingResult(
  db: Database,
  requestId: string,
): Promise<CreateCaseResult | null> {
  const [existingRequest] = await db
    .select()
    .from(intakeRequest)
    .where(eq(intakeRequest.requestId, requestId));
  if (!existingRequest) {
    return null;
  }

  const [[participant], [openingEvent], [identifier]] = await Promise.all([
    db.select().from(caseParticipant).where(eq(caseParticipant.caseId, existingRequest.caseId)),
    db
      .select()
      .from(caseLifecycleEvent)
      .where(
        and(
          eq(caseLifecycleEvent.caseId, existingRequest.caseId),
          eq(caseLifecycleEvent.sequenceNumber, 1),
        ),
      ),
    db.select().from(caseIdentifier).where(eq(caseIdentifier.caseId, existingRequest.caseId)),
  ]);

  return {
    caseId: existingRequest.caseId,
    caseParticipantId: participant?.caseParticipantId ?? '',
    caseLifecycleEventId: openingEvent?.caseLifecycleEventId ?? '',
    caseIdentifierId: identifier?.caseIdentifierId ?? null,
  };
}

async function checkReferenceExists(
  db: Database,
  table: PgTable,
  idColumn: AnyPgColumn,
  id: string,
  options: { requireActive?: boolean; validate?: (row: Record<string, unknown>) => string | null } = {},
): Promise<string | null> {
  const [row] = await db.select().from(table).where(eq(idColumn, id));
  if (!row) {
    return 'No matching record.';
  }
  if (options.requireActive && !(row as { active?: boolean }).active) {
    return 'Record is not active.';
  }
  return options.validate?.(row as Record<string, unknown>) ?? null;
}

export async function createCase(
  db: Database,
  actor: CreateCaseActor,
  rawInput: unknown,
): Promise<CreateCaseResult> {
  const parsed = createCaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input: CreateCaseInput = parsed.data;

  const existing = await findExistingResult(db, input.requestId);
  if (existing) {
    return existing;
  }

  // Validate concurrently via the pool before opening the transaction.
  // Foreign keys enforce existence at write time; pre-checks give field errors.
  const checks: Array<[string, Promise<string | null>]> = [
    ...(input.personId ? [['personId', checkReferenceExists(db, person, person.personId, input.personId)] as [string, Promise<string | null>]] : []),
    ...(input.newClient ? [['newClient', probableDuplicatePerson(db, input.newClient)] as [string, Promise<string | null>]] : []),
    ...(input.caseNumber ? [['caseNumber', existingCaseNumber(db, input.caseNumber)] as [string, Promise<string | null>]] : []),
    [
      'participantRoleId',
      checkReferenceExists(db, role, role.roleId, input.participantRoleId, {
        requireActive: true,
        validate: (row) =>
          row.roleContext !== 'case_participant'
            ? 'Role must have role_context "case_participant".'
            : null,
      }),
    ],
    [
      'statusId',
      checkReferenceExists(db, caseStatuses, caseStatuses.id, input.statusId, {
        requireActive: true,
      }),
    ],
  ];
  if (input.countyId) {
    checks.push([
      'countyId',
      checkReferenceExists(db, county, county.countyId, input.countyId, { requireActive: true }),
    ]);
  }
  if (input.caseCategoryId) {
    checks.push([
      'caseCategoryId',
      checkReferenceExists(db, caseCategories, caseCategories.id, input.caseCategoryId, {
        requireActive: true,
      }),
    ]);
  }
  if (input.organizationId) {
    checks.push([
      'organizationId',
      checkReferenceExists(db, organization, organization.organizationId, input.organizationId, {
        requireActive: true,
      }),
    ]);
  }
  if (input.officeId) {
    checks.push([
      'officeId',
      checkReferenceExists(db, office, office.officeId, input.officeId, {
        requireActive: true,
        validate: (row) =>
          input.organizationId && row.organizationId !== input.organizationId
            ? "Office must belong to the selected organization."
            : null,
      }),
    ]);
  }
  if (input.jurisdictionId) {
    checks.push([
      'jurisdictionId',
      checkReferenceExists(db, jurisdictions, jurisdictions.id, input.jurisdictionId, {
        requireActive: true,
      }),
    ]);
  }
  if (input.preferredLanguageId) {
    checks.push([
      'preferredLanguageId',
      checkReferenceExists(db, languages, languages.id, input.preferredLanguageId, {
        requireActive: true,
      }),
    ]);
  }
  if (input.identifier) {
    checks.push([
      'identifier.identifierTypeId',
      checkReferenceExists(
        db,
        caseIdentifierTypes,
        caseIdentifierTypes.id,
        input.identifier.identifierTypeId,
        { requireActive: true },
      ),
    ]);
  }

  const [checkResults, openingEventTypeId] = await Promise.all([
    Promise.all(checks.map(async ([field, check]) => [field, await check] as const)),
    getReferenceId(db, caseLifecycleEventTypes, OPENING_EVENT_TYPE_CODE),
  ]);

  const fieldErrors: Record<string, string> = {};
  for (const [field, message] of checkResults) {
    if (message) {
      fieldErrors[field] = message;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError(fieldErrors);
  }

  try {
    return await db.transaction(async (tx) => {
      const recordedAt = new Date();
      const personId =
        input.personId ??
        firstRow(
          await tx
            .insert(person)
            .values({ displayName: input.newClient!.displayName, email: input.newClient!.email })
            .returning({ personId: person.personId }),
        ).personId;

      const insertedCase = firstRow(
        await tx
          .insert(caseTable)
          .values({
            // Compatibility field; case_participant remains authoritative.
            clientId: personId,
            countyId: input.countyId,
            caseCategoryId: input.caseCategoryId,
            statusId: input.statusId,
            openedOn: calendarDateInReportingTimeZone(input.effectiveAt),
            organizationId: input.organizationId,
            officeId: input.officeId,
            jurisdictionId: input.jurisdictionId,
            preferredLanguageId: input.preferredLanguageId,
            // Intake snapshot; later identifier edits do not update this field automatically.
            externalReference: input.identifier?.isPrimary ? input.identifier.value : input.caseNumber,
          })
          .returning(),
      );

      const insertedParticipant = firstRow(
        await tx
          .insert(caseParticipant)
          .values({
            caseId: insertedCase.caseId,
            personId,
            participantRoleId: input.participantRoleId,
            startedAt: input.effectiveAt,
          })
          .returning(),
      );

      const insertedEvent = firstRow(
        await tx
          .insert(caseLifecycleEvent)
          .values({
            caseId: insertedCase.caseId,
            sequenceNumber: 1,
            eventTypeId: openingEventTypeId,
            resultingStatusId: input.statusId,
            effectiveAt: input.effectiveAt,
            recordedAt,
            actorUserAccountId: actor.userAccountId,
          })
          .returning(),
      );

      let insertedIdentifierId: string | null = null;
      if (input.identifier) {
        const insertedIdentifier = firstRow(
          await tx
            .insert(caseIdentifier)
            .values({
              caseId: insertedCase.caseId,
              identifierTypeId: input.identifier.identifierTypeId,
              issuer: input.identifier.issuer,
              value: input.identifier.value,
              isPrimary: input.identifier.isPrimary ?? false,
            })
            .returning(),
        );
        insertedIdentifierId = insertedIdentifier.caseIdentifierId;
      }

      // A duplicate request ID rolls back these writes; the catch returns the winner.
      await tx.insert(intakeRequest).values({
        requestId: input.requestId,
        caseId: insertedCase.caseId,
      });

      return {
        caseId: insertedCase.caseId,
        caseParticipantId: insertedParticipant.caseParticipantId,
        caseLifecycleEventId: insertedEvent.caseLifecycleEventId,
        caseIdentifierId: insertedIdentifierId,
      };
    });
  } catch (error) {
    // A concurrent replay can collide on its identifier before reaching the
    // request-ID insert. Recover the committed result for either conflict.
    const constraint = uniqueViolationConstraint(error);
    if (
      constraint === INTAKE_REQUEST_PRIMARY_KEY_CONSTRAINT ||
      constraint === CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT
    ) {
      const concurrentResult = await findExistingResult(db, input.requestId);
      if (concurrentResult) {
        return concurrentResult;
      }
    }
    if (constraint === CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT) {
      throw new ValidationError({
        identifier: 'A matching case identifier already exists for this issuer and type.',
      });
    }
    throw error;
  }
}
