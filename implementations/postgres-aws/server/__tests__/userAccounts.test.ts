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
    const account = await ensureUserAccountForEmail(testDb, 'staff2@example.com');

    expect(account.displayName).toBe('staff2@example.com');
    const [row] = await testDb.select().from(userAccount).where(eq(userAccount.userAccountId, account.userAccountId));
    expect(row?.email).toBe('staff2@example.com');
  });

  it('uses the given displayName when provided', async () => {
    const account = await ensureUserAccountForEmail(testDb, 'staff3@example.com', 'Staff Three');
    expect(account.displayName).toBe('Staff Three');
  });

  it('returns the existing account on a later call instead of creating a second one', async () => {
    const first = await ensureUserAccountForEmail(testDb, 'staff4@example.com');
    const second = await ensureUserAccountForEmail(testDb, 'staff4@example.com');

    expect(second.userAccountId).toBe(first.userAccountId);
    const rows = await testDb.select().from(userAccount).where(eq(userAccount.email, 'staff4@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('sets systemRoleId on a brand-new account when given one', async () => {
    const fixtures = await resetAndSeedBaselineFixtures(testDb);
    const account = await ensureUserAccountForEmail(
      testDb,
      'staff5@example.com',
      'Staff Five',
      fixtures.intakeStaffRoleId,
    );
    expect(account.systemRoleId).toBe(fixtures.intakeStaffRoleId);
  });

  it('gives an existing account with no role the role it is called with', async () => {
    const fixtures = await resetAndSeedBaselineFixtures(testDb);
    const first = await ensureUserAccountForEmail(testDb, 'staff6@example.com');
    expect(first.systemRoleId).toBeNull();

    const second = await ensureUserAccountForEmail(
      testDb,
      'staff6@example.com',
      'Staff Six',
      fixtures.intakeStaffRoleId,
    );
    expect(second.userAccountId).toBe(first.userAccountId);
    expect(second.systemRoleId).toBe(fixtures.intakeStaffRoleId);
  });

  it('never clears or replaces an existing role', async () => {
    const fixtures = await resetAndSeedBaselineFixtures(testDb);
    await ensureUserAccountForEmail(testDb, 'staff7@example.com', 'Staff Seven', fixtures.intakeStaffRoleId);

    const again = await ensureUserAccountForEmail(testDb, 'staff7@example.com');
    expect(again.systemRoleId).toBe(fixtures.intakeStaffRoleId);
  });

  it('matches emails case-insensitively, storing them lowercased', async () => {
    const first = await ensureUserAccountForEmail(testDb, 'Test.User@Example.com');
    const second = await ensureUserAccountForEmail(testDb, ' test.user@example.com ');

    expect(first.email).toBe('test.user@example.com');
    expect(second.userAccountId).toBe(first.userAccountId);
  });

  it('creates one account when two first logins race', async () => {
    const [first, second] = await Promise.all([
      ensureUserAccountForEmail(testDb, 'staff8@example.com'),
      ensureUserAccountForEmail(testDb, 'staff8@example.com'),
    ]);

    expect(second.userAccountId).toBe(first.userAccountId);
  });
});
