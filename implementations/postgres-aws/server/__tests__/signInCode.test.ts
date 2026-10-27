import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb, testPool } from './testDb';
import { issueSignInCode, SIGN_IN_CODE_MAX_ATTEMPTS, SIGN_IN_CODE_TTL_MS, verifySignInCode } from '../src/auth/signInCode';
import { signInCode } from '../src/db/schema';

beforeEach(async () => {
  await testDb.execute(sql`TRUNCATE TABLE ${signInCode}`);
});

afterAll(async () => {
  await testPool.end();
});

// A 6-digit code that isn't the one issued.
const wrong = (code: string) => ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');

describe('sign-in codes', () => {
  it('issues a 6-digit code that works once, for that email only', async () => {
    const code = await issueSignInCode(testDb, 'Vendor@Example.com');
    expect(code).toMatch(/^\d{6}$/);

    expect(await verifySignInCode(testDb, 'other@example.com', code)).toBeUndefined();
    expect(await verifySignInCode(testDb, ' vendor@example.COM ', code)).toBe('vendor@example.com');
    expect(await verifySignInCode(testDb, 'vendor@example.com', code)).toBeUndefined();
  });

  it('stores only a hash of the code', async () => {
    const code = await issueSignInCode(testDb, 'vendor@example.com');
    const [row] = await testDb.select().from(signInCode);
    expect(row?.codeHash).not.toContain(code);
  });

  it('rejects an expired code', async () => {
    const code = await issueSignInCode(testDb, 'vendor@example.com');
    await testDb.update(signInCode).set({ expiresAt: new Date(Date.now() - SIGN_IN_CODE_TTL_MS) });

    expect(await verifySignInCode(testDb, 'vendor@example.com', code)).toBeUndefined();
  });

  it('stops an earlier code working once a new one is sent', async () => {
    const first = await issueSignInCode(testDb, 'vendor@example.com');
    const second = await issueSignInCode(testDb, 'vendor@example.com');

    if (first !== second) {
      expect(await verifySignInCode(testDb, 'vendor@example.com', first)).toBeUndefined();
    }
    expect(await verifySignInCode(testDb, 'vendor@example.com', second)).toBe('vendor@example.com');
  });

  it('needs a new code after too many wrong ones', async () => {
    const code = await issueSignInCode(testDb, 'vendor@example.com');
    for (let attempt = 1; attempt < SIGN_IN_CODE_MAX_ATTEMPTS; attempt++) {
      expect(await verifySignInCode(testDb, 'vendor@example.com', wrong(code))).toBeUndefined();
    }
    // One try left: the right code still works...
    const [beforeLast] = await testDb.select().from(signInCode);
    expect(beforeLast?.usedAt).toBeNull();

    expect(await verifySignInCode(testDb, 'vendor@example.com', wrong(code))).toBeUndefined();
    // ...but not after the last wrong one.
    expect(await verifySignInCode(testDb, 'vendor@example.com', code)).toBeUndefined();
  });

  it('counts anything that is not 6 digits as a wrong try', async () => {
    const code = await issueSignInCode(testDb, 'vendor@example.com');
    expect(await verifySignInCode(testDb, 'vendor@example.com', 'abc')).toBeUndefined();
    const [row] = await testDb.select().from(signInCode);
    expect(row?.failedAttempts).toBe(1);
    expect(await verifySignInCode(testDb, 'vendor@example.com', code)).toBe('vendor@example.com');
  });
});
