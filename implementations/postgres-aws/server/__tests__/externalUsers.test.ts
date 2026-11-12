// Administrators turn on emailed-code sign-in for external users, or add one
// (model/rules.yaml manage_external_sign_in).
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { auditEvent, person, personAffiliation, professional, userAccount } from '../src/db/schema';
import { addProfessional } from '../src/professionals/addProfessional';
import { createKind } from '../src/billing/professionalRates';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';
import { externalSessionAllowed, externalSignInPersonId } from '../src/auth/externalSignIn';
import { addDelegateOffice, endDelegateOffice, listExternalUsers, searchExternalUsers, setExternalSignIn, turnOnExternalSignIn } from '../src/people/externalUsers';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { delegateOfficeIds } from '../src/portal/portalActor';
import { getDelegateAffiliationRoleId } from '../src/professionals/delegateRole';
import { mergePeople, previewMerge, undoMerges } from '../src/people/personMerges';
import { ConflictError, ValidationError } from '../src/errors';

let fixtures: BaselineFixtureIds;
let admin: string;
let kindId: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  admin = fixtures.staffUserAccountId;
  kindId = (await createKind(testDb, { displayName: 'Synthetic Investigator' })).professionalKindId;
});

afterAll(async () => {
  await testPool.end();
});

const firstBatch = { limit: 50, after: null };

describe('turning on sign-in', () => {
  it('lets an existing provider sign in only once it is on, and refuses turning it on twice', async () => {
    const { professionalId } = await addProfessional(testDb, admin, { displayName: 'Ada Sample', email: 'ada@example.com', professionalKindId: kindId });
    const [{ personId }] = (await testDb.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, professionalId))) as [{ personId: string }];
    expect(await externalSignInPersonId(testDb, 'ada@example.com')).toBeUndefined();
    expect((await searchExternalUsers(testDb, 'ada')).map((user) => user.signInEnabled)).toEqual([false]);

    const user = await turnOnExternalSignIn(testDb, admin, { personId });
    expect(user).toMatchObject({ displayName: 'Ada Sample', email: 'ada@example.com', kind: 'Synthetic Investigator', signInEnabled: true, hasSignedIn: false });
    expect(await externalSignInPersonId(testDb, 'ADA@example.com ')).toBe(personId);
    await expect(turnOnExternalSignIn(testDb, admin, { personId })).rejects.toThrow(ConflictError);
    expect(await testDb.select({ eventType: auditEvent.eventType, actor: auditEvent.actorUserAccountId }).from(auditEvent).where(eq(auditEvent.entityId, personId))).toEqual([
      { eventType: 'external_sign_in_enabled', actor: admin },
    ]);
  });

  it('needs an email first for someone with none, and refuses one already in use', async () => {
    const { professionalId } = await addProfessional(testDb, admin, { displayName: 'Bo Sample', professionalKindId: kindId });
    await addProfessional(testDb, admin, { displayName: 'Cy Sample', email: 'taken@example.com', professionalKindId: kindId });
    const [{ personId }] = (await testDb.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, professionalId))) as [{ personId: string }];

    await expect(turnOnExternalSignIn(testDb, admin, { personId })).rejects.toThrow(ValidationError);
    await expect(turnOnExternalSignIn(testDb, admin, { personId, email: 'taken@example.com' })).rejects.toThrow(ValidationError);
    await expect(setExternalSignIn(testDb, admin, personId, { signInEnabled: true })).rejects.toThrow(ValidationError);

    expect(await turnOnExternalSignIn(testDb, admin, { personId, email: 'Bo@Example.com' })).toMatchObject({ email: 'bo@example.com', signInEnabled: true });
    const events = await testDb.select({ eventType: auditEvent.eventType, priorValues: auditEvent.priorValues }).from(auditEvent).where(eq(auditEvent.entityId, personId));
    expect(events).toEqual(
      expect.arrayContaining([
        { eventType: 'person_email_added', priorValues: { email: null } },
        { eventType: 'external_sign_in_enabled', priorValues: { externalSignInEnabled: false } },
      ]),
    );
  });

  it('adds a new provider with sign-in on, refusing a missing or duplicate email', async () => {
    await expect(turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Di Sample', professionalKindId: kindId } })).rejects.toThrow(ValidationError);
    const user = await turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Di Sample', email: 'di@example.com', professionalKindId: kindId } });
    expect(user).toMatchObject({ displayName: 'Di Sample', kind: 'Synthetic Investigator', signInEnabled: true });
    await expect(
      turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Di Again', email: 'di@example.com', professionalKindId: kindId } }),
    ).rejects.toThrow(ValidationError);
  });

  it('adds a new office delegate who, on signing in, acts for the office without a provider profile', async () => {
    await expect(
      turnOnExternalSignIn(testDb, admin, { newDelegate: { displayName: 'Eve Sample', email: 'eve@example.com' } }),
    ).rejects.toThrow(ValidationError);
    const user = await turnOnExternalSignIn(testDb, admin, { newDelegate: { displayName: 'Eve Sample', email: 'eve@example.com', officeId: fixtures.officeId } });
    expect(user).toMatchObject({ kind: null, signInEnabled: true });
    expect(user.delegateFor).toHaveLength(1);
    const [affiliation] = await testDb
      .select()
      .from(personAffiliation)
      .where(and(eq(personAffiliation.personId, user.personId), eq(personAffiliation.affiliationRoleId, await getDelegateAffiliationRoleId(testDb))));
    expect(affiliation).toMatchObject({ officeId: fixtures.officeId, endedAt: null });
    expect(await externalSignInPersonId(testDb, 'eve@example.com')).toBe(user.personId);
  });
});

describe('making a provider a delegate', () => {
  it('lets a provider who signed in before send for an office, once, until an administrator stops it', async () => {
    const user = await turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Lu Sample', email: 'lu@example.com', professionalKindId: kindId } });
    // Signed in as a provider, before delegation, so their account has no person yet.
    const account = await ensureUserAccountForEmail(testDb, 'lu@example.com');
    await ensureProfessionalForUserAccount(testDb, account.userAccountId, 'Lu Sample');
    expect(await delegateOfficeIds(testDb, account.userAccountId)).toEqual([]);

    await expect(addDelegateOffice(testDb, admin, user.personId, {})).rejects.toThrow(ValidationError);
    const delegate = await addDelegateOffice(testDb, admin, user.personId, { officeId: fixtures.officeId });
    expect(delegate).toMatchObject({ kind: 'Synthetic Investigator', delegateFor: [{ officeId: fixtures.officeId }] });
    expect(await delegateOfficeIds(testDb, account.userAccountId)).toEqual([fixtures.officeId]);
    await expect(addDelegateOffice(testDb, admin, user.personId, { officeId: fixtures.officeId })).rejects.toThrow(ConflictError);

    expect((await endDelegateOffice(testDb, admin, user.personId, fixtures.officeId)).delegateFor).toEqual([]);
    // A delegate with no profile of their own stays listed after their last office, so sign-in can still be turned off.
    const only = await turnOnExternalSignIn(testDb, admin, { newDelegate: { displayName: 'Pia Sample', email: 'pia@example.com', officeId: fixtures.officeId } });
    expect((await endDelegateOffice(testDb, admin, only.personId, fixtures.officeId)).delegateFor).toEqual([]);
    expect((await setExternalSignIn(testDb, admin, only.personId, { signInEnabled: false })).signInEnabled).toBe(false);
    expect((await listExternalUsers(testDb, 'pia', firstBatch)).items).toHaveLength(1);
    expect(await delegateOfficeIds(testDb, account.userAccountId)).toEqual([]);
    // The ending is kept, never deleted.
    expect((await testDb.select().from(personAffiliation).where(eq(personAffiliation.personId, user.personId)))[0]!.endedAt).not.toBeNull();
    const events = await testDb.select({ eventType: auditEvent.eventType }).from(auditEvent).where(eq(auditEvent.entityId, user.personId));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(['external_delegate_office_added', 'external_delegate_office_ended']));
  });
});

describe('emails that would clash', () => {
  it('refuses a new provider with an email a delegate already has', async () => {
    await turnOnExternalSignIn(testDb, admin, { newDelegate: { displayName: 'Mo Sample', email: 'mo@example.com', officeId: fixtures.officeId } });
    await expect(
      turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Mo Other', email: 'mo@example.com', professionalKindId: kindId } }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to turn on someone whose email is a staff or deactivated account's", async () => {
    const { professionalId } = await addProfessional(testDb, admin, { displayName: 'Ned Sample', email: 'ned@example.com', professionalKindId: kindId });
    const [{ personId }] = (await testDb.select({ personId: professional.personId }).from(professional).where(eq(professional.professionalId, professionalId))) as [{ personId: string }];
    const account = await ensureUserAccountForEmail(testDb, 'ned@example.com', 'Ned Sample', fixtures.intakeStaffRoleId);
    await expect(turnOnExternalSignIn(testDb, admin, { personId })).rejects.toMatchObject({ fieldErrors: { email: expect.stringContaining('staff account') } });
    await testDb.update(userAccount).set({ systemRoleId: null, active: false }).where(eq(userAccount.userAccountId, account.userAccountId));
    await expect(turnOnExternalSignIn(testDb, admin, { personId })).rejects.toMatchObject({ fieldErrors: { email: expect.stringContaining('deactivated') } });
  });
});

describe('who may sign in', () => {
  it("goes by the account's own person once it has one, so a code never signs someone straight out", async () => {
    const account = await ensureUserAccountForEmail(testDb, 'oz@example.com', 'Oz Sample');
    const [linked] = await testDb.insert(person).values({ displayName: 'Oz Sample' }).returning();
    await testDb.update(userAccount).set({ personId: linked!.personId }).where(eq(userAccount.userAccountId, account.userAccountId));
    await testDb.insert(person).values({ displayName: 'Oz Other', email: 'oz@example.com', externalSignInEnabled: true });
    expect(await externalSignInPersonId(testDb, 'oz@example.com')).toBeUndefined();
    await testDb.update(person).set({ externalSignInEnabled: true }).where(eq(person.personId, linked!.personId));
    expect(await externalSignInPersonId(testDb, 'oz@example.com')).toBe(linked!.personId);
    expect(await externalSessionAllowed(testDb, account.userAccountId)).toBe(true);
  });

  it('matches the email of an account they signed in with before, and never a staff account', async () => {
    const account = await ensureUserAccountForEmail(testDb, 'fay@example.com', 'Fay Sample');
    const [signedIn] = await testDb.insert(person).values({ displayName: 'Fay Sample', externalSignInEnabled: true }).returning();
    await testDb.update(userAccount).set({ personId: signedIn!.personId }).where(eq(userAccount.userAccountId, account.userAccountId));
    expect(await externalSignInPersonId(testDb, 'fay@example.com')).toBe(signedIn!.personId);
    expect(await externalSessionAllowed(testDb, account.userAccountId)).toBe(true);

    await testDb.update(userAccount).set({ systemRoleId: fixtures.intakeStaffRoleId }).where(eq(userAccount.userAccountId, account.userAccountId));
    expect(await externalSignInPersonId(testDb, 'fay@example.com')).toBeUndefined();
    expect(await externalSessionAllowed(testDb, account.userAccountId)).toBe(false);
  });

  it('stops matching once sign-in is turned off or the person is merged away, and lists them as off', async () => {
    const user = await turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Gus Sample', email: 'gus@example.com', professionalKindId: kindId } });
    const off = await setExternalSignIn(testDb, admin, user.personId, { signInEnabled: false });
    expect(off.signInEnabled).toBe(false);
    expect(off.signInChangedAt).not.toBeNull();
    expect(await externalSignInPersonId(testDb, 'gus@example.com')).toBeUndefined();
    expect((await listExternalUsers(testDb, 'gus', firstBatch)).items.map((row) => row.signInEnabled)).toEqual([false]);

    await setExternalSignIn(testDb, admin, user.personId, { signInEnabled: true });
    await testDb.update(person).set({ mergedIntoPersonId: fixtures.clientPersonId }).where(eq(person.personId, user.personId));
    expect(await externalSignInPersonId(testDb, 'gus@example.com')).toBeUndefined();
  });

  it('carries sign-in to the kept person in a merge only with an account that moves, never over a turn-off, and undoes it', async () => {
    const signInOf = async (personId: string) => (await testDb.select().from(person).where(eq(person.personId, personId)))[0]!.externalSignInEnabled;
    const personOf = async (professionalId: string) => (await testDb.select().from(professional).where(eq(professional.professionalId, professionalId)))[0]!.personId;
    const kept = await personOf((await addProfessional(testDb, admin, { displayName: 'Kim Sample', email: 'kim@example.com', professionalKindId: kindId })).professionalId);
    const retired = await turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: 'Kim Sample', email: 'kim.office@example.com', professionalKindId: kindId } });
    const filledIn = async () => (await previewMerge(testDb, admin, kept, [retired.personId])).retired[0]!;

    // Never signed in: no account moves, so nothing carries.
    expect((await filledIn()).notMoved).toEqual(expect.arrayContaining([expect.stringContaining('External sign-in')]));
    const account = await ensureUserAccountForEmail(testDb, 'kim.office@example.com');
    await ensureProfessionalForUserAccount(testDb, account.userAccountId, 'Kim Sample');
    expect((await filledIn()).filledIn).toContainEqual({ label: 'External sign-in', value: 'On' });

    const {
      personMergeIds: [personMergeId],
    } = await mergePeople(testDb, admin, { keptPersonId: kept, retiredPersonIds: [retired.personId] });
    expect(await signInOf(kept)).toBe(true);
    expect(await externalSessionAllowed(testDb, account.userAccountId)).toBe(true);
    await undoMerges(testDb, admin, [personMergeId]);
    expect(await signInOf(kept)).toBe(false);
    const events = await testDb.select({ eventType: auditEvent.eventType }).from(auditEvent).where(eq(auditEvent.entityId, kept));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(['external_sign_in_enabled', 'external_sign_in_disabled']));

    // That undo recorded a turn-off, so a merge no longer turns it on.
    expect((await filledIn()).notMoved).toEqual(expect.arrayContaining([expect.stringContaining('turned Kim Sample’s off'.replace('’', "'"))]));
  });

  it('lists only those turned on or off here, a batch at a time', async () => {
    await addProfessional(testDb, admin, { displayName: 'Never On', email: 'never@example.com', professionalKindId: kindId });
    for (const name of ['Hal', 'Ida', 'Jo']) {
      await turnOnExternalSignIn(testDb, admin, { newProvider: { displayName: `${name} Sample`, email: `${name}@example.com`, professionalKindId: kindId } });
    }
    const first = await listExternalUsers(testDb, undefined, { limit: 2, after: null });
    expect(first.items.map((row) => row.displayName)).toEqual(['Hal Sample', 'Ida Sample']);
    const rest = await listExternalUsers(testDb, undefined, { limit: 2, after: JSON.parse(Buffer.from(first.next!, 'base64url').toString()) as string[] });
    expect(rest).toMatchObject({ items: [{ displayName: 'Jo Sample' }], next: null });
  });
});
