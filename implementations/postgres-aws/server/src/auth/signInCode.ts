// One-time 6-digit codes for external-user sign-in. Access is gated by
// EXTERNAL_EMAIL_WHITELIST (see ./externalEmailWhitelist.ts) one layer up in
// the route; this module only issues and checks codes for an email a caller
// has already decided may have one.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { signInCode } from '../db/schema';
import { normalizeEmail } from './emailLists';

export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000;
// Tries per code, the right one included; then a new code is needed.
export const SIGN_IN_CODE_MAX_ATTEMPTS = 5;

// Keyed, so a leaked row can't be matched against all million codes offline.
function hashCode(email: string, code: string): string {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-secret';
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

// Returns the code to email; only its hash is stored. Any earlier unused
// code for this email stops working, so only the latest one is ever live.
export async function issueSignInCode(db: Database, email: string): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  // Sequential, not concurrent: the update must not catch the new row.
  await db
    .update(signInCode)
    .set({ usedAt: new Date() })
    .where(and(eq(signInCode.email, normalizedEmail), isNull(signInCode.usedAt)));
  await db.insert(signInCode).values({
    email: normalizedEmail,
    codeHash: hashCode(normalizedEmail, code),
    expiresAt: new Date(Date.now() + SIGN_IN_CODE_TTL_MS),
  });
  return code;
}

// Consumes the email's live code if it matches, returning the normalized
// email. A wrong, expired, used or exhausted code all fail the same way.
export async function verifySignInCode(db: Database, email: string, code: string): Promise<string | undefined> {
  const normalizedEmail = normalizeEmail(email);
  const live = db
    .select({ id: signInCode.signInCodeId })
    .from(signInCode)
    .where(and(eq(signInCode.email, normalizedEmail), isNull(signInCode.usedAt), gt(signInCode.expiresAt, new Date())))
    .orderBy(desc(signInCode.createdAt))
    .limit(1);
  // Each try is counted before the code is compared, in one statement, so
  // guesses sent at once can't get past the limit.
  const [attempt] = await db
    .update(signInCode)
    .set({ failedAttempts: sql`${signInCode.failedAttempts} + 1` })
    .where(
      and(
        inArray(signInCode.signInCodeId, live),
        isNull(signInCode.usedAt),
        lt(signInCode.failedAttempts, SIGN_IN_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning();
  if (!attempt) {
    return undefined;
  }

  const expected = Buffer.from(attempt.codeHash, 'hex');
  const given = Buffer.from(hashCode(normalizedEmail, code.trim()), 'hex');
  const matches = /^\d{6}$/.test(code.trim()) && timingSafeEqual(expected, given);
  if (!matches) {
    if (attempt.failedAttempts >= SIGN_IN_CODE_MAX_ATTEMPTS) {
      await db.update(signInCode).set({ usedAt: new Date() }).where(eq(signInCode.signInCodeId, attempt.signInCodeId));
    }
    return undefined;
  }
  // Only one of two verifies of the same code wins.
  const [used] = await db
    .update(signInCode)
    .set({ usedAt: new Date() })
    .where(and(eq(signInCode.signInCodeId, attempt.signInCodeId), isNull(signInCode.usedAt)))
    .returning();
  return used ? normalizedEmail : undefined;
}
