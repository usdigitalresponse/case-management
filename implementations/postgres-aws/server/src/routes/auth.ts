import { Router } from 'express';
import passport from 'passport';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { userAccount } from '../db/schema';
import { getSessionUser, setSessionUser } from '../auth/session';
import type { AuthenticatedUser, OidcProviderConfig } from '../auth/oidcProviders';
import { passportStrategyName } from '../auth/oidcProviders';
import { isWhitelistedExternalEmail } from '../auth/externalEmailWhitelist';
import { issueMagicLinkToken, consumeMagicLinkToken } from '../auth/magicLink';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { sendEmail } from '../email/sendEmail';
import { asyncHandler } from './asyncHandler';

export interface AuthRouterOptions {
  // Configured full-user providers (see ../auth/oidcProviders.ts) —
  // empty when no provider's credentials are set.
  oidcProviders: OidcProviderConfig[];
  // Bypasses SSO entirely, logging in as the seeded synthetic staff
  // account (see src/db/fixtures.ts).
  devLoginEnabled: boolean;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  // Enforced here, not just by the NODE_ENV check the one current caller
  // (../app.ts) happens to apply before setting this flag — a future
  // second call site (a script, a test harness against a real DB) could
  // otherwise pass devLoginEnabled: true with no NODE_ENV guard and
  // silently reopen an auth bypass in production.
  if (options.devLoginEnabled && process.env.NODE_ENV === 'production') {
    throw new Error('devLoginEnabled must never be true when NODE_ENV=production.');
  }

  const router = Router();

  router.get('/providers', (_req, res) => {
    res.json({
      providers: options.oidcProviders.map(({ id, displayName }) => ({ id, displayName })),
      devLoginEnabled: options.devLoginEnabled,
    });
  });

  for (const provider of options.oidcProviders) {
    const strategyName = passportStrategyName(provider.id);
    router.get(`/${provider.id}`, passport.authenticate(strategyName, { session: false }));

    router.get(
      `/${provider.id}/callback`,
      passport.authenticate(strategyName, { session: false, failureRedirect: '/auth/failure' }),
      (req, res) => {
        setSessionUser(req, req.user as AuthenticatedUser);
        res.redirect('/');
      },
    );
  }

  router.post(
    '/magic-link/request',
    asyncHandler(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      // Always respond the same way whether or not the email is
      // whitelisted, so this endpoint can't be used to enumerate which
      // external addresses are allowed in.
      if (email && isWhitelistedExternalEmail(email)) {
        const token = await issueMagicLinkToken(db, email);
        // Must be the origin the browser should end up on (the client dev
        // server in local dev, which proxies /auth to this server — see
        // ../../client/vite.config.ts), not this server's own origin: the
        // verify route below ends with res.redirect('/'), which needs to
        // resolve against the client, not a bare API server with no '/'.
        const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
        const link = `${baseUrl}/auth/magic-link/verify?token=${token}`;
        // Not awaited: the response below is identical either way, so
        // there's no reason to hold the request open for an SES round
        // trip. Send failures are swallowed for the same reason they're
        // not awaited for — logged for ops visibility, never surfaced to
        // the caller.
        sendEmail(
          email,
          'Sign in to Case Management',
          `Use this link to sign in (it expires in 15 minutes): ${link}`,
        ).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('Failed to send magic-link email:', error);
        });
      }
      res.status(202).json({ message: 'If that email is recognized, a sign-in link has been sent.' });
    }),
  );

  router.get(
    '/magic-link/verify',
    asyncHandler(async (req, res) => {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const email = token ? await consumeMagicLinkToken(db, token) : undefined;
      if (!email) {
        res.redirect('/auth/failure');
        return;
      }

      const account = await ensureUserAccountForEmail(db, email);
      await ensureProfessionalForUserAccount(db, account.userAccountId, account.displayName);

      const user: AuthenticatedUser = {
        userAccountId: account.userAccountId,
        email: account.email,
        displayName: account.displayName,
        authType: 'magic-link',
      };
      setSessionUser(req, user);
      res.redirect('/');
    }),
  );

  router.get('/failure', (_req, res) => {
    res.status(401).json({ error: 'Sign-in failed, or this account is not allowed to sign in.' });
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    const user = getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json(user);
  });

  if (options.devLoginEnabled) {
    router.post(
      '/dev-login',
      asyncHandler(async (req, res) => {
        const [staff] = await db
          .select()
          .from(userAccount)
          .where(eq(userAccount.email, 'staff@example.invalid'));
        if (!staff) {
          res.status(500).json({ error: 'Seeded dev account not found; run `npm run seed` first.' });
          return;
        }
        const user: AuthenticatedUser = {
          userAccountId: staff.userAccountId,
          email: staff.email,
          displayName: staff.displayName,
          authType: 'sso',
        };
        setSessionUser(req, user);
        res.json(user);
      }),
    );
  }

  return router;
}
