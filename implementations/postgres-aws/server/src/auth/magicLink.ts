// Token issuance/consumption for external-user sign-in. Access is gated by
// EXTERNAL_EMAIL_WHITELIST (see ./externalEmailWhitelist.ts) one layer up in
// the route — this module doesn't know about the whitelist, only about
// tokens once a caller has decided an email may have one.
import { randomBytes, createHash } from 'node:crypto';
import { eq, isNull, and } from 'drizzle-orm';
import type { Database } from '../db/client';
import { magicLinkToken } from '../db/schema';
import { normalizeEmail } from './emailLists';

// Short-lived: the link is meant to be used immediately after requesting
// it, not saved for later — shorter windows shrink the damage if an email
// account (rather than this app) is compromised.
export const MAGIC_LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

// Returns the raw token (to put in the emailed link); only its hash is
// persisted, so reading the table never yields a usable token.
export async function issueMagicLinkToken(db: Database, email: string): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const rawToken = randomBytes(32).toString('hex');

  // Invalidate any earlier unused link for this email first, so a repeat
  // "send me a link" click (or a stale link still sitting in an inbox)
  // can't be used alongside the new one — only the most recently
  // requested link is ever live. Deliberately sequential, not
  // Promise.all'd: the new row also starts with usedAt null, so running
  // this concurrently with the insert below risks the update's WHERE
  // clause catching the brand-new row and invalidating it immediately.
  await db
    .update(magicLinkToken)
    .set({ usedAt: new Date() })
    .where(and(eq(magicLinkToken.email, normalizedEmail), isNull(magicLinkToken.usedAt)));

  await db.insert(magicLinkToken).values({
    email: normalizedEmail,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + MAGIC_LINK_TOKEN_TTL_MS),
  });
  return rawToken;
}

// Consumes a token exactly once: an expired, already-used, or unrecognized
// token all fail the same way (undefined), so callers can't distinguish
// "wrong token" from "token already used" and replay a captured link.
export async function consumeMagicLinkToken(db: Database, rawToken: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(magicLinkToken)
    .where(and(eq(magicLinkToken.tokenHash, hashToken(rawToken)), isNull(magicLinkToken.usedAt)));

  if (!row || row.expiresAt.getTime() < Date.now()) {
    return undefined;
  }

  const [updated] = await db
    .update(magicLinkToken)
    .set({ usedAt: new Date() })
    .where(and(eq(magicLinkToken.magicLinkTokenId, row.magicLinkTokenId), isNull(magicLinkToken.usedAt)))
    .returning();

  // Lost the race to a concurrent consume of the same token (e.g. an email
  // client prefetching the link): treat as invalid rather than letting both
  // callers in.
  return updated ? row.email : undefined;
}
