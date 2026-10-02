import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, testPool } from './testDb';
import { issueMagicLinkToken, consumeMagicLinkToken, MAGIC_LINK_TOKEN_TTL_MS } from '../src/auth/magicLink';
import { magicLinkToken } from '../src/db/schema';

beforeEach(async () => {
  await testDb.execute(sql`TRUNCATE TABLE ${magicLinkToken}`);
});

afterAll(async () => {
  await testPool.end();
});

describe('magic link tokens', () => {
  it('consumes a freshly issued token exactly once', async () => {
    const token = await issueMagicLinkToken(testDb, 'Vendor@Example.com');

    expect(await consumeMagicLinkToken(testDb, token)).toBe('vendor@example.com');
    expect(await consumeMagicLinkToken(testDb, token)).toBeUndefined();
  });

  it('rejects an unrecognized token', async () => {
    expect(await consumeMagicLinkToken(testDb, 'not-a-real-token')).toBeUndefined();
  });

  it('rejects an expired token', async () => {
    const token = await issueMagicLinkToken(testDb, 'vendor@example.com');
    await testDb
      .update(magicLinkToken)
      .set({ expiresAt: new Date(Date.now() - MAGIC_LINK_TOKEN_TTL_MS) })
      .where(sql`token_hash is not null`);

    expect(await consumeMagicLinkToken(testDb, token)).toBeUndefined();
  });
});
