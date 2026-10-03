import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures } from '../src/db/fixtures';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { professional, userAccount } from '../src/db/schema';

beforeEach(async () => {
  await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function createUserAccount(email: string) {
  const [account] = await testDb
    .insert(userAccount)
    .values({ displayName: email, email, active: true })
    .returning();
  if (!account) {
    throw new Error('Expected insert to return a row.');
  }
  return account;
}

describe('ensureProfessionalForUserAccount', () => {
  it('creates a person and professional row on first call', async () => {
    const account = await createUserAccount('vendor@example.com');

    const professionalId = await ensureProfessionalForUserAccount(testDb, account.userAccountId, 'vendor@example.com');

    const [row] = await testDb.select().from(professional).where(eq(professional.professionalId, professionalId));
    expect(row?.userAccountId).toBe(account.userAccountId);
    expect(row?.displayName).toBe('vendor@example.com');
  });

  it('returns the existing professional on a later call instead of creating a second one', async () => {
    const account = await createUserAccount('vendor2@example.com');

    const first = await ensureProfessionalForUserAccount(testDb, account.userAccountId, 'vendor2@example.com');
    const second = await ensureProfessionalForUserAccount(testDb, account.userAccountId, 'vendor2@example.com');

    expect(second).toBe(first);
    const rows = await testDb.select().from(professional).where(eq(professional.userAccountId, account.userAccountId));
    expect(rows).toHaveLength(1);
  });

  it('creates exactly one professional when two logins race for the same account', async () => {
    const account = await createUserAccount('vendor3@example.com');

    const [first, second] = await Promise.all([
      ensureProfessionalForUserAccount(testDb, account.userAccountId, 'vendor3@example.com'),
      ensureProfessionalForUserAccount(testDb, account.userAccountId, 'vendor3@example.com'),
    ]);

    expect(second).toBe(first);
    const rows = await testDb.select().from(professional).where(eq(professional.userAccountId, account.userAccountId));
    expect(rows).toHaveLength(1);
  });
});
