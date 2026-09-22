// Shared intake handler for model/forms.yaml:new_case. One function, one
// transaction, mirroring the Dataverse comparison plan's shared-handler
// requirements (docs/case-intake-comparison-plan.md) despite being a
// separate implementation track.
import { eq, and } from 'drizzle-orm';
import type { PgTable, AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client';
import { firstRow } from '../db/rowHelpers';
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

export type { CreateCaseInput, CreateCaseIdentifierInput } from './validation';

// The seeded code for the "opening" lifecycle event type. The server derives
// this, not the caller, per forms.yaml — a synthetic default, not a resolved
// product decision (see MAPPING.md).
const OPENING_EVENT_TYPE_CODE = 'sample_open';

// The IANA time zone used to derive calendar dates (e.g. opened_on) from an
// effective instant. UTC is a synthetic single-environment default pending
// an actual per-organization decision — time zone is explicitly named as an
// open configurable choice in docs/case-intake-comparison-plan.md. Kept as
// one named constant so a real per-org value is a one-line change, not a
// logic rewrite.
const REPORTING_TIME_ZONE = 'UTC';

function calendarDateInReportingTimeZone(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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

export class CreateCaseValidationError extends Error {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Invalid create-case request');
    this.name = 'CreateCaseValidationError';
    this.fieldErrors = fieldErrors;
  }
}

// Server misconfiguration (e.g. a required seeded reference row is
// missing) — distinct from a bad request, since no client input could have
// avoided it.
export class CreateCaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateCaseConfigurationError';
  }
}

// drizzle-orm wraps the raw pg error (.code/.constraint) in a
// DrizzleQueryError with the original on .cause — verified against the
// actual thrown shape.
function uniqueViolationConstraint(error: unknown): string | null {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === '23505'
    ) {
      return (candidate as { constraint?: string }).constraint ?? '';
    }
  }
  return null;
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

// `table`/`idColumn` are typed as real Drizzle table/column types (not
// `any`), so passing something that isn't a valid table or column is still
// a type error — an earlier version type-erased both to `any` for a
// data-driven list of checks, trading away exactly the type safety FK
// reference correctness depends on, for a modest line-count saving;
// reverted after a second review flagged it. `validate`'s row is untyped
// per-table (Drizzle's `.from()` typing doesn't support that generically
// here) but is still a real row object, not `any`.
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
    throw new CreateCaseValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input: CreateCaseInput = parsed.data;

  // Idempotency: a retried request with the same request_id returns the
  // original result instead of creating a second case (scenario: repeated
  // submissions in scenarios/new-case.md).
  const existing = await findExistingResult(db, input.requestId);
  if (existing) {
    return existing;
  }

  // Every reference must resolve to its declared entity, and be active
  // where applicable (model/rules.yaml: validate_case_children,
  // validate_effective_relationships). Run via `db` (the connection pool),
  // not inside the transaction below: a single Postgres connection can't
  // usefully run queries concurrently (drizzle/pg will warn or serialize
  // them anyway), so genuine concurrency here means separate pool
  // connections, issued before the transaction opens. These are read-only
  // pre-checks for a friendly field error; the FK constraints in
  // src/db/schema.ts are the actual integrity boundary enforced at insert
  // time regardless.
  const checks: Array<[string, Promise<string | null>]> = [
    ['personId', checkReferenceExists(db, person, person.personId, input.personId)],
    [
      'participantRoleId',
      checkReferenceExists(db, role, role.roleId, input.participantRoleId, {
        requireActive: true,
        // model/rules.yaml validate_effective_relationships: the referenced
        // role must match this field's context.
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
      checkReferenceExists(db, office, office.officeId, input.officeId, { requireActive: true }),
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

  // Independent of the reference checks above; batched into the same
  // Promise.all so it doesn't cost an extra serialized round-trip.
  const openingEventTypePromise = db
    .select()
    .from(caseLifecycleEventTypes)
    .where(eq(caseLifecycleEventTypes.code, OPENING_EVENT_TYPE_CODE));

  const [checkResults, [openingEventType]] = await Promise.all([
    Promise.all(checks.map(async ([field, check]) => [field, await check] as const)),
    openingEventTypePromise,
  ]);

  const fieldErrors: Record<string, string> = {};
  for (const [field, message] of checkResults) {
    if (message) {
      fieldErrors[field] = message;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new CreateCaseValidationError(fieldErrors);
  }

  if (!openingEventType) {
    throw new CreateCaseConfigurationError(
      `Missing required seeded case_lifecycle_event_types row with code "${OPENING_EVENT_TYPE_CODE}".`,
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const recordedAt = new Date();

      const insertedCase = firstRow(
        await tx
          .insert(caseTable)
          .values({
            // Compatibility reference to the client-role person; this intake
            // journey always creates the client participant (model/schema.yaml:
            // case.client_id; case_participant is authoritative).
            clientId: input.personId,
            countyId: input.countyId,
            caseCategoryId: input.caseCategoryId,
            statusId: input.statusId,
            openedOn: calendarDateInReportingTimeZone(input.effectiveAt),
            organizationId: input.organizationId,
            officeId: input.officeId,
            jurisdictionId: input.jurisdictionId,
            preferredLanguageId: input.preferredLanguageId,
            // Write-time sync, not a live projection (external_reference is
            // a plain field per AGENTS.md). scenarios/new-case.md scenario 3
            // requires it to match the primary identifier at intake.
            externalReference: input.identifier?.isPrimary ? input.identifier.value : undefined,
          })
          .returning(),
      );

      const insertedParticipant = firstRow(
        await tx
          .insert(caseParticipant)
          .values({
            caseId: insertedCase.caseId,
            personId: input.personId,
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
            eventTypeId: openingEventType.id,
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

      // If a concurrent request with the same request_id committed first,
      // this insert throws a unique violation; the outer catch below
      // treats it as a retry and returns the winner's result (scenario:
      // concurrent submissions in scenarios/new-case.md).
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
    // Deliberate asymmetry: identifier *existence* is pre-checked above
    // (cheap, and needed before the insert can even be attempted), but
    // identifier *uniqueness* (issuer+type+value) is only knowable by
    // attempting the write — a pre-check here would just duplicate the
    // unique index below without removing the need for this catch (a
    // concurrent request could still collide between the two). So
    // uniqueness is handled reactively, via the same constraint-matching
    // mechanism as idempotent replay.
    const constraint = uniqueViolationConstraint(error);
    if (constraint === INTAKE_REQUEST_PRIMARY_KEY_CONSTRAINT) {
      const concurrentResult = await findExistingResult(db, input.requestId);
      if (concurrentResult) {
        return concurrentResult;
      }
    }
    if (constraint === CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT) {
      throw new CreateCaseValidationError({
        identifier: 'A matching case identifier already exists for this issuer and type.',
      });
    }
    throw error;
  }
}
