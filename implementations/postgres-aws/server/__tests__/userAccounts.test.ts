import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures } from '../src/db/fixtures';
import { ensureUserAccountForEmail } from '../src/auth/userAccounts';
import { userAccount } from '../src/db/schema';

beforeEach(async () => {
  await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

describe('ensureUserAccountForEmail', () => {
  it('creates a user_account on first call, defaulting displayName to the email', async () => {
    const account = await ensureUserAccountForEmail(testDb, 'staff2@usdigitalresponse.org');

    expect(account.displayName).toBe('staff2@usdigitalresponse.org');
    const [row] = await testDb.select().from(userAccount).where(eq(userAccount.userAccountId, account.userAccountId));
    expect(row?.email).toBe('staff2@usdigitalresponse.org');
  });

  it('uses the given displayName when provided', async () => {
    const account = await ensureUserAccountForEmail(testDb, 'staff3@usdigitalresponse.org', 'Staff Three');
    expect(account.displayName).toBe('Staff Three');
  });

  it('returns the existing account on a later call instead of creating a second one', async () => {
    const first = await ensureUserAccountForEmail(testDb, 'staff4@usdigitalresponse.org');
    const second = await ensureUserAccountForEmail(testDb, 'staff4@usdigitalresponse.org');

    expect(second.userAccountId).toBe(first.userAccountId);
    const rows = await testDb.select().from(userAccount).where(eq(userAccount.email, 'staff4@usdigitalresponse.org'));
    expect(rows).toHaveLength(1);
  });

  it('sets systemRoleId on a brand-new account when given one', async () => {
    const fixtures = await resetAndSeedBaselineFixtures(testDb);
    const account = await ensureUserAccountForEmail(
      testDb,
      'staff5@usdigitalresponse.org',
      'Staff Five',
      fixtures.intakeStaffRoleId,
    );
    expect(account.systemRoleId).toBe(fixtures.intakeStaffRoleId);
  });

  it('gives an existing account with no role the role it is called with', async () => {
    const fixtures = await resetAndSeedBaselineFixtures(testDb);
    const first = await ensureUserAccountForEmail(testDb, 'staff6@usdigitalresponse.org');
    expect(first.systemRoleId).toBeNull();

    const second = await ensureUserAccountForEmail(
      testDb,
      'staff6@usdigitalresponse.org',
      'Staff Six',
      fixtures.intakeStaffRoleId,
    );
    expect(second.userAccountId).toBe(first.userAccountId);
    expect(second.systemRoleId).toBe(fixtures.intakeStaffRoleId);
  });

  it('never clears or replaces an existing role', async () => {
    const fixtures = await resetAndSeedBaselineFixtures(testDb);
    await ensureUserAccountForEmail(testDb, 'staff7@usdigitalresponse.org', 'Staff Seven', fixtures.intakeStaffRoleId);

    const again = await ensureUserAccountForEmail(testDb, 'staff7@usdigitalresponse.org');
    expect(again.systemRoleId).toBe(fixtures.intakeStaffRoleId);
  });

  it('matches emails case-insensitively, storing them lowercased', async () => {
    const first = await ensureUserAccountForEmail(testDb, 'Jane.Doe@USDigitalResponse.org');
    const second = await ensureUserAccountForEmail(testDb, ' jane.doe@usdigitalresponse.org ');

    expect(first.email).toBe('jane.doe@usdigitalresponse.org');
    expect(second.userAccountId).toBe(first.userAccountId);
  });

  it('creates one account when two first logins race', async () => {
    const [first, second] = await Promise.all([
      ensureUserAccountForEmail(testDb, 'staff8@usdigitalresponse.org'),
      ensureUserAccountForEmail(testDb, 'staff8@usdigitalresponse.org'),
    ]);

    expect(second.userAccountId).toBe(first.userAccountId);
  });
});
