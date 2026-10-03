import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase, type CreateCaseInput } from '../src/intake/createCase';
import { ValidationError } from '../src/errors';
import {
  caseTable,
  caseParticipant,
  caseLifecycleEvent,
  caseIdentifier,
  person,
  role,
  caseStatuses,
  organization,
} from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

function baseInput(overrides: Partial<CreateCaseInput> = {}): CreateCaseInput {
  return {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-15T12:00:00Z'),
    ...overrides,
  };
}

// scenarios/new-case.md scenario 1
describe('minimum case', () => {
  it('creates a case, participant and opening event in one transaction, viewable again', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const result = await createCase(testDb, actor, baseInput());

    const [savedCase] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, result.caseId));
    expect(savedCase?.statusId).toBe(fixtures.caseStatusOpenId);

    const [savedParticipant] = await testDb
      .select()
      .from(caseParticipant)
      .where(eq(caseParticipant.caseParticipantId, result.caseParticipantId));
    expect(savedParticipant?.personId).toBe(fixtures.clientPersonId);
    expect(savedParticipant?.participantRoleId).toBe(fixtures.clientParticipantRoleId);

    const [openingEvent] = await testDb
      .select()
      .from(caseLifecycleEvent)
      .where(eq(caseLifecycleEvent.caseLifecycleEventId, result.caseLifecycleEventId));
    expect(openingEvent?.sequenceNumber).toBe(1);
    expect(openingEvent?.actorUserAccountId).toBe(actor.userAccountId);
    expect(openingEvent?.resultingStatusId).toBe(fixtures.caseStatusOpenId);
    expect(openingEvent?.recordedAt).toBeInstanceOf(Date);
  });
});

// scenarios/new-case.md scenario 2
describe('required input', () => {
  const actor = { userAccountId: '' };

  beforeEach(() => {
    actor.userAccountId = fixtures.staffUserAccountId;
  });

  it.each([
    ['personId', { personId: '' }],
    ['participantRoleId', { participantRoleId: '' }],
    ['statusId', { statusId: '' }],
  ])('rejects a missing %s and leaves no orphan case or event', async (_label, overrides) => {
    await expect(createCase(testDb, actor, baseInput(overrides))).rejects.toBeInstanceOf(ValidationError);

    const remainingCases = await testDb.select().from(caseTable);
    expect(remainingCases).toHaveLength(0);
    const remainingEvents = await testDb.select().from(caseLifecycleEvent);
    expect(remainingEvents).toHaveLength(0);
  });

  it('rejects a missing effectiveAt', async () => {
    const input = baseInput();
    // @ts-expect-error deliberately omitting a required field
    delete input.effectiveAt;
    await expect(createCase(testDb, actor, input)).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });

  it('rejects an unknown statusId (invalid reference, not just missing)', async () => {
    await expect(
      createCase(testDb, actor, baseInput({ statusId: randomUUID() })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });

  it('rejects a malformed (non-UUID) personId as a validation error, not a raw driver error', async () => {
    await expect(
      createCase(testDb, actor, baseInput({ personId: 'not-a-uuid' })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });
});

describe('reference activeness', () => {
  it('rejects an inactive participantRoleId', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const [inactiveRole] = await testDb
      .insert(role)
      .values({ displayName: 'Inactive Client', roleContext: 'case_participant', active: false })
      .returning();
    await expect(
      createCase(testDb, actor, baseInput({ participantRoleId: inactiveRole?.roleId })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });

  it('rejects an inactive statusId', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const [inactiveStatus] = await testDb
      .insert(caseStatuses)
      .values({ code: 'sample_inactive', displayName: 'Inactive', active: false })
      .returning();
    await expect(
      createCase(testDb, actor, baseInput({ statusId: inactiveStatus?.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });
});

describe('reporting time zone', () => {
  it('derives opened_on from the configured reporting time zone (UTC default), not the instant sliced naively', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    // 2026-01-15T23:00:00-08:00 is 2026-01-16T07:00:00Z: the UTC calendar
    // date is one day ahead of the submitter's local date.
    const result = await createCase(
      testDb,
      actor,
      baseInput({ effectiveAt: new Date('2026-01-15T23:00:00-08:00') }),
    );
    const [savedCase] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, result.caseId));
    expect(savedCase?.openedOn).toBe('2026-01-16');
  });
});

// scenarios/new-case.md scenario 3
describe('complete intake', () => {
  it('persists optional context and a primary identifier, syncing external_reference', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const result = await createCase(
      testDb,
      actor,
      baseInput({
        countyId: fixtures.countyId,
        caseCategoryId: fixtures.caseCategoryHousingId,
        organizationId: fixtures.organizationId,
        officeId: fixtures.officeId,
        jurisdictionId: fixtures.jurisdictionSampleId,
        preferredLanguageId: fixtures.languageSampleId,
        identifier: {
          identifierTypeId: fixtures.identifierTypeSampleId,
          issuer: 'sample-issuer',
          value: 'SAMPLE-0001',
          isPrimary: true,
        },
      }),
    );

    const [savedCase] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, result.caseId));
    expect(savedCase?.countyId).toBe(fixtures.countyId);
    expect(savedCase?.caseCategoryId).toBe(fixtures.caseCategoryHousingId);
    expect(savedCase?.organizationId).toBe(fixtures.organizationId);
    expect(savedCase?.officeId).toBe(fixtures.officeId);
    expect(savedCase?.externalReference).toBe('SAMPLE-0001');

    expect(result.caseIdentifierId).not.toBeNull();
    const [savedIdentifier] = await testDb
      .select()
      .from(caseIdentifier)
      .where(eq(caseIdentifier.caseIdentifierId, result.caseIdentifierId as string));
    expect(savedIdentifier?.issuer).toBe('sample-issuer');
    expect(savedIdentifier?.isPrimary).toBe(true);
  });

  it('rejects an incomplete identifier', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    await expect(
      createCase(
        testDb,
        actor,
        baseInput({
          identifier: {
            identifierTypeId: fixtures.identifierTypeSampleId,
            issuer: '',
            value: '',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });
});

// scenarios/new-case.md scenario 4, narrowed: createCase only ever creates
// one new case with one participant, so "add a second client participant to
// the first case" (an edit to an existing case) is out of scope for this
// handler — see MAPPING.md. This covers the reachable part: reusing one
// existing person across two separately-created cases creates no new person
// row.
describe('person reuse', () => {
  it('links the same existing person to two cases without creating a new person', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const first = await createCase(testDb, actor, baseInput());
    const second = await createCase(testDb, actor, baseInput());

    expect(first.caseId).not.toBe(second.caseId);

    const people = await testDb.select().from(person);
    expect(people).toHaveLength(2); // seeded client + staff, no new rows

    const [firstParticipant] = await testDb
      .select()
      .from(caseParticipant)
      .where(eq(caseParticipant.caseParticipantId, first.caseParticipantId));
    const [secondParticipant] = await testDb
      .select()
      .from(caseParticipant)
      .where(eq(caseParticipant.caseParticipantId, second.caseParticipantId));
    expect(firstParticipant?.personId).toBe(fixtures.clientPersonId);
    expect(secondParticipant?.personId).toBe(fixtures.clientPersonId);
  });
});

// scenarios/new-case.md scenario 5, narrowed: this handler has no
// edit-identifier operation to exercise "reviewers can inspect old/new
// values" (out of scope — see MAPPING.md). This covers the reachable part:
// the immutability/serialization invariants preserve_case_lifecycle and
// validate_case_children rely on are enforced at the database level.
describe('history integrity', () => {
  it('rejects a second lifecycle event with the same sequence number for a case', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const result = await createCase(testDb, actor, baseInput());

    await expect(
      testDb.insert(caseLifecycleEvent).values({
        caseId: result.caseId,
        sequenceNumber: 1,
        eventTypeId: fixtures.lifecycleEventTypeOpenId,
        resultingStatusId: fixtures.caseStatusOpenId,
        effectiveAt: new Date(),
        recordedAt: new Date(),
        actorUserAccountId: actor.userAccountId,
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate case identifier for the same issuer and type', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const identifier = {
      identifierTypeId: fixtures.identifierTypeSampleId,
      issuer: 'sample-issuer',
      value: 'DUPLICATE-0001',
      isPrimary: true,
    };
    await createCase(testDb, actor, baseInput({ identifier }));

    await expect(
      createCase(testDb, actor, baseInput({ identifier: { ...identifier, isPrimary: false } })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('HTTP-shaped input', () => {
  it('accepts effectiveAt as a JSON string, not just a Date instance', async () => {
    // Every other test passes a real Date (baseInput() constructs one);
    // real HTTP bodies never do (JSON has no Date type). Caught a real bug:
    // z.date() rejected every actual request despite passing all these
    // Date-based unit tests.
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const rawInput = { ...baseInput(), effectiveAt: '2026-01-15T12:00:00Z' };
    const result = await createCase(testDb, actor, rawInput);
    expect(result.caseId).toBeDefined();
  });
});

describe('request_id idempotency', () => {
  it('returns the original result for a retried request_id instead of creating a second case', async () => {
    const actor = { userAccountId: fixtures.staffUserAccountId };
    const input = baseInput();

    const first = await createCase(testDb, actor, input);
    const retried = await createCase(testDb, actor, input);

    expect(retried.caseId).toBe(first.caseId);
    expect(await testDb.select().from(caseTable)).toHaveLength(1);
  });
});


describe('organization and office compatibility', () => {
  it('rejects an office belonging to another organization without saving a case', async () => {
    const [other] = await testDb.insert(organization).values({ displayName: 'Other organization' }).returning();
    await expect(createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, baseInput({
      organizationId: other!.organizationId,
      officeId: fixtures.officeId,
    }))).rejects.toMatchObject({ fieldErrors: { officeId: 'Office must belong to the selected organization.' } });
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });
});

describe('concurrent request replay', () => {
  it('returns the same complete result for concurrent requests with an identifier', async () => {
    const input = baseInput({ identifier: {
      identifierTypeId: fixtures.identifierTypeSampleId,
      issuer: 'sample-issuer', value: 'CONCURRENT-0001', isPrimary: true,
    } });
    // Hold both callers after their initial request lookup, before either writes.
    const transaction = testDb.transaction.bind(testDb);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    let arrivals = 0;
    const spy = vi.spyOn(testDb, 'transaction').mockImplementation(async (...args) => {
      if (++arrivals === 2) release();
      await ready;
      return transaction(...args);
    });
    try {
      const actor = { userAccountId: fixtures.staffUserAccountId };
      const [first, second] = await Promise.all([
        createCase(testDb, actor, input), createCase(testDb, actor, input),
      ]);
      expect(second).toEqual(first);
      expect(await testDb.select().from(caseTable)).toHaveLength(1);
      expect(await testDb.select().from(caseIdentifier)).toHaveLength(1);
      expect(await testDb.select().from(caseParticipant)).toHaveLength(1);
      expect(await testDb.select().from(caseLifecycleEvent)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
