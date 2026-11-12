import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { pool } from '../src/db/client';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createKind } from '../src/billing/professionalRates';
import { addProfessional } from '../src/professionals/addProfessional';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { listPeopleBatch } from '../src/professionals/peopleDirectory';
import { createCase } from '../src/intake/createCase';
import { familyKey, listPossibleDuplicates, nameKey, recordDuplicateReview } from '../src/people/possibleDuplicates';
import { listMerges, mergePeople, previewMerge, undoMerges } from '../src/people/personMerges';
import { caseAssignment, caseTable, invoice, person, professional, professionalRate, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;
let admin: string;
let kindId: string;

// What merging one record into another would do.
const planFor = async (keptPersonId: string, retiredPersonId: string) => (await previewMerge(testDb, admin, keptPersonId, [retiredPersonId])).retired[0]!;
// Each pair in the list, by its people.
const listedPairs = async () =>
  (await listPossibleDuplicates(testDb)).flatMap((group) => group.pairs.map((pair) => ({ ids: [...pair.personIds].sort(), reasons: pair.reasons, flagged: pair.flagged })));

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  admin = await createStaff('admin');
  kindId = (await createKind(testDb, { displayName: 'Synthetic investigator' })).professionalKindId;
});

afterAll(async () => {
  await pool.end();
  await testPool.end();
});

const personOf = async (professionalId: string) =>
  (await testDb.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, professionalId)))[0]!.personId;

// Staff add them with a rate; they later sign in with another email, which adds them again.
async function addedTwice(name = 'Jordan Example') {
  const added = await addProfessional(testDb, admin, { displayName: name, email: 'jordan@example.invalid', professionalKindId: kindId, hourlyRate: 90 });
  const [account] = await testDb.insert(userAccount).values({ displayName: name, email: `other-${randomUUID()}@example.invalid`, active: true }).returning();
  const signedIn = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, name);
  const [sent] = await testDb
    .insert(invoice)
    .values({ submittedByUserAccountId: account!.userAccountId, professionalId: signedIn, statusId: fixtures.invoiceStatusDraftId, submittedTotal: '0.00' })
    .returning();
  return {
    kept: { professionalId: added.professionalId, personId: await personOf(added.professionalId) },
    retired: { professionalId: signedIn, personId: await personOf(signedIn), userAccountId: account!.userAccountId },
    invoiceId: sent!.invoiceId,
  };
}

describe('name keys', () => {
  it('ignore word order, punctuation, case and initials', () => {
    expect(nameKey('Doe, Jane Q.')).toBe(nameKey('jane doe'));
    expect(familyKey({ displayName: 'Doe, Jane', familyName: null })).toBe('doe');
    expect(familyKey({ displayName: 'Jane Doe', familyName: null })).toBe('doe');
  });
});

describe('possible duplicates', () => {
  it('pairs people by name, email, or birth date and family name', async () => {
    const [a, b, c, d, e] = await testDb
      .insert(person)
      .values([
        { displayName: 'Doe, Jane' },
        { displayName: 'Jane Doe' },
        { displayName: 'Sam Sample', email: 'Sam@Example.invalid' },
        { displayName: 'S. Sample', email: 'sam@example.invalid' },
        { displayName: 'Alex Lee', dateOfBirth: '1980-02-03' },
      ])
      .returning();
    const [f] = await testDb.insert(person).values({ displayName: 'Alexandra Lee', dateOfBirth: '1980-02-03' }).returning();

    const pairs = await listedPairs();
    expect(pairs).toContainEqual({ ids: [a!.personId, b!.personId].sort(), reasons: ['same_name'], flagged: null });
    expect(pairs).toContainEqual({ ids: [c!.personId, d!.personId].sort(), reasons: ['same_email'], flagged: null });
    expect(pairs).toContainEqual({ ids: [e!.personId, f!.personId].sort(), reasons: ['same_birth_date_and_family_name'], flagged: null });
    expect(await listPossibleDuplicates(testDb)).toHaveLength(3);
  });

  it('lists a flagged pair until staff find they are different people', async () => {
    const staff = await createStaff('staff');
    const [a, b] = await testDb.insert(person).values([{ displayName: 'Robin One' }, { displayName: 'Robin Two' }]).returning();
    const ids = [b!.personId, a!.personId];
    await recordDuplicateReview(testDb, staff, { personIds: ids, outcome: 'possible_duplicate', note: 'Same phone number' });
    const [flagged] = await listedPairs();
    expect(flagged?.reasons).toEqual(['flagged']);
    expect(flagged?.flagged?.note).toBe('Same phone number');

    await recordDuplicateReview(testDb, staff, { personIds: ids, outcome: 'not_duplicate' });
    expect(await listPossibleDuplicates(testDb)).toEqual([]);
  });

  it('groups everyone linked by any match as one likely person', async () => {
    const [a, b, c] = await testDb
      .insert(person)
      .values([
        { displayName: 'Riley Sample', email: 'riley@example.invalid' },
        { displayName: 'Sample, Riley' },
        { displayName: 'R. J. Sample', email: 'RILEY@example.invalid' },
      ])
      .returning();
    const [group] = await listPossibleDuplicates(testDb);
    expect(group?.people.map((one) => one.personId).sort()).toEqual([a!.personId, b!.personId, c!.personId].sort());
    expect(group?.pairs).toHaveLength(2);
  });
});

describe('merging', () => {
  it('previews, moves everything to the kept person, and undoes', async () => {
    const { kept, retired, invoiceId } = await addedTwice();
    expect((await listedPairs()).map((pair) => pair.reasons)).toEqual([['same_name']]);

    const preview = await planFor(kept.personId, retired.personId);
    expect(preview.blockers).toEqual([]);
    expect(preview.moves).toContainEqual({ label: 'Invoices filed under them', count: 1 });
    expect(preview.moves.map((move) => move.label)).toContain(`Sign-in: ${(await testDb.select().from(userAccount).where(eq(userAccount.userAccountId, retired.userAccountId)))[0]!.email} will open Jordan Example's invoices`);

    const {
      personMergeIds: [personMergeId],
    } = await mergePeople(testDb, admin, { keptPersonId: kept.personId, retiredPersonIds: [retired.personId] });
    expect((await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId)))[0]!.professionalId).toBe(kept.professionalId);
    // Their sign-in now opens the kept profile, with its rate.
    expect(await ensureProfessionalForUserAccount(testDb, retired.userAccountId, 'Jordan Example')).toBe(kept.professionalId);
    expect(((await listPeopleBatch(testDb, {}, { limit: 200, after: null })).items).map((one) => one.professionalId)).toEqual([kept.professionalId]);
    expect(await listPossibleDuplicates(testDb)).toEqual([]);
    expect((await listMerges(testDb))[0]).toMatchObject({ personMergeId, kept: { personId: kept.personId }, retired: { personId: retired.personId }, undoneAt: null });

    expect((await undoMerges(testDb, admin, [personMergeId])).leftAsIs).toBe(0);
    expect((await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId)))[0]!.professionalId).toBe(retired.professionalId);
    expect(await ensureProfessionalForUserAccount(testDb, retired.userAccountId, 'Jordan Example')).toBe(retired.professionalId);
    expect(((await listPeopleBatch(testDb, {}, { limit: 200, after: null })).items).map((one) => one.professionalId).sort()).toEqual([kept.professionalId, retired.professionalId].sort());
    await expect(undoMerges(testDb, admin, [personMergeId])).rejects.toMatchObject({ code: 'already_undone' });
  });

  it("keeps the kept person's own rates and leaves the other's behind", async () => {
    const { kept, retired } = await addedTwice();
    await testDb.insert(professionalRate).values({
      professionalId: retired.professionalId,
      hourlyRate: '200.00',
      effectiveFrom: '2000-01-01',
      recordedByUserAccountId: admin,
      recordedAt: new Date(),
    });
    const preview = await planFor(kept.personId, retired.personId);
    expect(preview.notMoved).toEqual([expect.stringMatching(/^Their own rates: Jordan Example's stay in use/)]);
    await mergePeople(testDb, admin, { keptPersonId: kept.personId, retiredPersonIds: [retired.personId] });
    const rates = await testDb.select().from(professionalRate).where(eq(professionalRate.professionalId, kept.professionalId));
    expect(rates.map((rate) => rate.hourlyRate)).toEqual(['90.00']);
  });

  it('is refused when both sign in', async () => {
    const { kept, retired } = await addedTwice();
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Jordan Example', email: `kept-${randomUUID()}@example.invalid`, active: true }).returning();
    await testDb.update(professional).set({ userAccountId: account!.userAccountId }).where(eq(professional.professionalId, kept.professionalId));
    expect((await planFor(kept.personId, retired.personId)).blockers[0]).toMatch(/^Both sign in/);
    await expect(mergePeople(testDb, admin, { keptPersonId: kept.personId, retiredPersonIds: [retired.personId] })).rejects.toMatchObject({ code: 'merge_blocked' });
    expect((await testDb.select().from(person).where(eq(person.personId, retired.personId)))[0]!.mergedIntoPersonId).toBeNull();
  });

  it('is refused when both are assigned to the same case', async () => {
    const { kept, retired } = await addedTwice();
    const { caseId } = await createCase(
      testDb,
      { userAccountId: fixtures.staffUserAccountId },
      {
        requestId: randomUUID(),
        personId: fixtures.clientPersonId,
        participantRoleId: fixtures.clientParticipantRoleId,
        statusId: fixtures.caseStatusOpenId,
        effectiveAt: new Date('2026-01-15T12:00:00Z'),
      },
    );
    await testDb.insert(caseAssignment).values(
      [kept.professionalId, retired.professionalId].map((professionalId) => ({
        caseId,
        professionalId,
        assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
        assignedAt: new Date(),
        assignedByUserAccountId: admin,
      })),
    );
    expect((await planFor(kept.personId, retired.personId)).blockers).toEqual(['Both are assigned to the same case. End one of the assignments first.']);
  });

  it('moves a client to the kept person and fills in what the kept record lacks', async () => {
    const { caseId } = await createCase(
      testDb,
      { userAccountId: fixtures.staffUserAccountId },
      {
        requestId: randomUUID(),
        personId: fixtures.clientPersonId,
        participantRoleId: fixtures.clientParticipantRoleId,
        statusId: fixtures.caseStatusOpenId,
        effectiveAt: new Date('2026-01-15T12:00:00Z'),
      },
    );
    await testDb.update(person).set({ dateOfBirth: '1990-01-01' }).where(eq(person.personId, fixtures.clientPersonId));
    const [copy] = await testDb.insert(person).values({ displayName: 'Client Copy' }).returning();

    const preview = await planFor(copy!.personId, fixtures.clientPersonId);
    expect(preview.moves).toEqual([{ label: 'Roles on cases', count: 1 }]);
    expect(preview.filledIn).toContainEqual({ label: 'Date of birth', value: '1990-01-01' });
    await mergePeople(testDb, admin, { keptPersonId: copy!.personId, retiredPersonIds: [fixtures.clientPersonId] });
    const [kept] = await testDb.select().from(person).where(eq(person.personId, copy!.personId));
    expect(kept!.dateOfBirth).toBe('1990-01-01');
    const [moved] = await testDb.select().from(caseTable).where(eq(caseTable.caseId, caseId));
    expect(moved!.clientId).toBe(copy!.personId);
  });

  it('merges several records into one, previews without changing anything, and undoes them together', async () => {
    const { kept, retired, invoiceId } = await addedTwice();
    const [third] = await testDb.insert(person).values({ displayName: 'Jordan Example', dateOfBirth: '1985-05-05' }).returning();

    const preview = await previewMerge(testDb, admin, kept.personId, [retired.personId, third!.personId]);
    expect(preview.retired.map((plan) => plan.person.personId)).toEqual([retired.personId, third!.personId]);
    expect(preview.retired[1]!.filledIn).toEqual([{ label: 'Date of birth', value: '1985-05-05' }]);
    expect((await testDb.select().from(person).where(eq(person.personId, third!.personId)))[0]!.mergedIntoPersonId).toBeNull();
    expect((await listPossibleDuplicates(testDb))[0]?.people).toHaveLength(3);

    const { personMergeIds } = await mergePeople(testDb, admin, { keptPersonId: kept.personId, retiredPersonIds: [retired.personId, third!.personId] });
    expect(personMergeIds).toHaveLength(2);
    expect(await listPossibleDuplicates(testDb)).toEqual([]);
    expect((await testDb.select().from(person).where(eq(person.personId, kept.personId)))[0]!.dateOfBirth).toBe('1985-05-05');

    await undoMerges(testDb, admin, personMergeIds);
    expect((await testDb.select().from(invoice).where(eq(invoice.invoiceId, invoiceId)))[0]!.professionalId).toBe(retired.professionalId);
    expect((await testDb.select().from(person).where(eq(person.personId, kept.personId)))[0]!.dateOfBirth).toBeNull();
    expect((await listPossibleDuplicates(testDb))[0]?.people).toHaveLength(3);
  });

  it('merges none of a group when one record is blocked', async () => {
    const { kept, retired } = await addedTwice();
    const [third] = await testDb.insert(person).values({ displayName: 'Jordan Example' }).returning();
    const [account] = await testDb.insert(userAccount).values({ displayName: 'Jordan Example', email: `kept-${randomUUID()}@example.invalid`, active: true }).returning();
    await testDb.update(professional).set({ userAccountId: account!.userAccountId }).where(eq(professional.professionalId, kept.professionalId));

    await expect(mergePeople(testDb, admin, { keptPersonId: kept.personId, retiredPersonIds: [third!.personId, retired.personId] })).rejects.toMatchObject({
      code: 'merge_blocked',
    });
    expect((await testDb.select().from(person).where(eq(person.personId, third!.personId)))[0]!.mergedIntoPersonId).toBeNull();
  });
});
