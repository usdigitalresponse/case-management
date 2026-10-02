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
});
