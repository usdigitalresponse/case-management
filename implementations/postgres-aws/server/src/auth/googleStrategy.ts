// Google OAuth restricted to a hosted-domain allowlist. This gates access
// for USDR's own team while building/demoing this prototype — it is NOT
// the government partner's production login (see ../../MAPPING.md).
import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { userAccount } from '../db/schema';
import { firstRow } from '../db/rowHelpers';

const ALLOWED_EMAIL_DOMAINS = ['usdigitalresponse.org', 'usdrvolunteers.org'];

export interface AuthenticatedUser {
  userAccountId: string;
  email: string;
  displayName: string;
}

function isAllowedEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// Registers the strategy only if credentials are configured, and reports
// whether it did, so app.ts knows whether to mount /auth/google at all
// (passport throws on an unregistered strategy name).
export function configureGoogleAuth(): boolean {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) {
    return false;
  }
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      async (_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email || !isAllowedEmail(email)) {
            done(null, false, { message: 'Email domain is not allowed to sign in.' });
            return;
          }

          const [existing] = await db.select().from(userAccount).where(eq(userAccount.email, email));
          // Real accounts are created on first login, matched by email —
          // never seeded with real addresses (see ../../MAPPING.md).
          const account =
            existing ??
            firstRow(
              await db
                .insert(userAccount)
                .values({ displayName: profile.displayName || email, email, active: true })
                .returning(),
            );

          const user: AuthenticatedUser = {
            userAccountId: account.userAccountId,
            email: account.email,
            displayName: account.displayName,
          };
          done(null, user);
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );

  return true;
}
