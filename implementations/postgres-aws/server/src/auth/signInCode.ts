// One-time 6-digit codes for external-user sign-in. Access is gated by
// EXTERNAL_EMAIL_WHITELIST (see ./externalEmailWhitelist.ts) one layer up in
// the route; this module only issues and checks codes for an email a caller
// has already decided may have one.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { signInCode } from '../db/schema';
import { normalizeEmail } from './emailLists';

export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000;
// After this many wrong codes the code stops working and a new one is needed.
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
  const [row] = await db
    .select()
    .from(signInCode)
    .where(and(eq(signInCode.email, normalizedEmail), isNull(signInCode.usedAt), gt(signInCode.expiresAt, new Date())))
    .orderBy(desc(signInCode.createdAt))
    .limit(1);
  if (!row) {
    return undefined;
  }

  const expected = Buffer.from(row.codeHash, 'hex');
  const given = Buffer.from(hashCode(normalizedEmail, code.trim()), 'hex');
  if (!/^\d{6}$/.test(code.trim()) || !timingSafeEqual(expected, given)) {
    await db
      .update(signInCode)
      .set({
        failedAttempts: sql`${signInCode.failedAttempts} + 1`,
        usedAt: sql`case when ${signInCode.failedAttempts} + 1 >= ${SIGN_IN_CODE_MAX_ATTEMPTS} then now() else null end`,
      })
      .where(and(eq(signInCode.signInCodeId, row.signInCodeId), isNull(signInCode.usedAt)));
    return undefined;
  }

  // Lost a race with a concurrent verify of the same code: only one wins.
  const [updated] = await db
    .update(signInCode)
    .set({ usedAt: new Date() })
    .where(and(eq(signInCode.signInCodeId, row.signInCodeId), isNull(signInCode.usedAt)))
    .returning();
  return updated ? normalizedEmail : undefined;
}
