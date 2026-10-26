import { Router } from 'express';
import passport from 'passport';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { userAccount } from '../db/schema';
import { getSessionUser, setSessionUser } from '../auth/session';
import { isAdmin } from '../auth/requireAdmin';
import { loadReviewPermissions } from '../billing/reviewAccess';
import type { AuthenticatedUser, OidcProviderConfig } from '../auth/oidcProviders';
import { passportStrategyName } from '../auth/oidcProviders';
import { isWhitelistedExternalEmail } from '../auth/externalEmailWhitelist';
import { normalizeEmail } from '../auth/emailLists';
import { issueMagicLinkToken, consumeMagicLinkToken } from '../auth/magicLink';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { delegateOfficeIds } from '../portal/portalActor';
import { EXTERNAL_DEMO_EMAIL } from '../db/demoAccounts';
import { listDemoPartners, listDemoStaff, STAFF_DEMO_EMAIL } from '../auth/demoAccounts';
import { sendEmail } from '../email/sendEmail';
import { asyncHandler } from './asyncHandler';

export interface AuthRouterOptions {
  // Configured full-user providers (see ../auth/oidcProviders.ts) —
  // empty when no provider's credentials are set.
  oidcProviders: OidcProviderConfig[];
  // Passwordless sign-in as a seeded synthetic staff account, by default
  // the administrator (see ../db/fixtures.ts and MAPPING.md "Demo sign-in").
  demoLoginEnabled: boolean;
  // Passwordless sign-in as a seeded demo vendor (an external user), who is
  // also its office's billing delegate.
  externalDemoLoginEnabled: boolean;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();

  router.get('/providers', (_req, res) => {
    res.json({
      providers: options.oidcProviders.map(({ id, displayName }) => ({ id, displayName })),
      demoLoginEnabled: options.demoLoginEnabled,
      externalDemoLoginEnabled: options.externalDemoLoginEnabled,
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
      const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      // Always respond the same way whether or not the email is
      // whitelisted, so this endpoint can't be used to enumerate which
      // external addresses are allowed in.
      if (email && isWhitelistedExternalEmail(email)) {
        const token = await issueMagicLinkToken(db, email);
        // Points at the client's confirm page, not at the verify endpoint:
        // email link scanners (Safe Links, Gmail) GET every link before the
        // user clicks, so the token must only be consumed by the page's
        // POST to /magic-link/verify below.
        const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
        const link = `${baseUrl}/sign-in/verify?token=${encodeURIComponent(token)}`;
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

  router.post(
    '/magic-link/verify',
    asyncHandler(async (req, res) => {
      const token = typeof req.body?.token === 'string' ? req.body.token : '';
      const email = token ? await consumeMagicLinkToken(db, token) : undefined;
      if (!email) {
        res.status(401).json({ error: 'This sign-in link is invalid, expired, or already used.' });
        return;
      }

      const account = await ensureUserAccountForEmail(db, email);
      // A delegate acts for others and needs no professional profile of
      // their own (model/rules.yaml authorize_delegated_submission).
      if ((await delegateOfficeIds(db, account.userAccountId)).length === 0) {
        await ensureProfessionalForUserAccount(db, account.userAccountId, account.displayName);
      }

      const user: AuthenticatedUser = {
        userAccountId: account.userAccountId,
        email: account.email,
        displayName: account.displayName,
        authType: 'magic-link',
      };
      setSessionUser(req, user);
      res.json(user);
    }),
  );

  router.get('/failure', (_req, res) => {
    res.status(401).json({ error: 'Sign-in failed, or this account is not allowed to sign in.' });
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.status(204).end();
  });

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const user = getSessionUser(req);
      if (!user) {
        res.status(401).json({ error: 'Not signed in.' });
        return;
      }
      // Shows or hides Settings and review actions; the routes check them themselves.
      const staff = user.authType === 'sso';
      res.json({
        ...user,
        isAdmin: staff && (await isAdmin(db, user.userAccountId)),
        reviewPermissions: staff ? await loadReviewPermissions(db, user.userAccountId) : null,
      });
    }),
  );

  if (options.demoLoginEnabled || options.externalDemoLoginEnabled) {
    // Whom each demo sign-in may act as.
    router.get(
      '/demo-accounts',
      asyncHandler(async (_req, res) => {
        res.json({
          staff: options.demoLoginEnabled ? await listDemoStaff(db) : [],
          partners: options.externalDemoLoginEnabled ? await listDemoPartners(db) : [],
        });
      }),
    );
  }

  // Sign in as the chosen demo account, else the default one.
  const chosenAccountId = (body: unknown) => {
    const id = (body as { userAccountId?: unknown } | undefined)?.userAccountId;
    return typeof id === 'string' && id ? id : undefined;
  };

  if (options.demoLoginEnabled) {
    router.post(
      '/demo-login',
      asyncHandler(async (req, res) => {
        const chosen = chosenAccountId(req.body);
        const demoStaff = chosen ? (await listDemoStaff(db)).find((account) => account.userAccountId === chosen) : undefined;
        if (chosen && !demoStaff) {
          res.status(400).json({ error: 'Choose one of the demo staff accounts.' });
          return;
        }
        const [staff] = await db
          .select()
          .from(userAccount)
          .where(demoStaff ? eq(userAccount.userAccountId, demoStaff.userAccountId) : eq(userAccount.email, STAFF_DEMO_EMAIL));
        if (!staff) {
          res.status(500).json({ error: 'Seeded demo account not found; run `npm run seed` first.' });
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

  if (options.externalDemoLoginEnabled) {
    router.post(
      '/demo-login/external',
      asyncHandler(async (req, res) => {
        const chosen = chosenAccountId(req.body);
        const partner = chosen ? (await listDemoPartners(db)).find((account) => account.userAccountId === chosen) : undefined;
        if (chosen && !partner) {
          res.status(400).json({ error: 'Choose one of the demo partner accounts.' });
          return;
        }
        const [vendor] = await db
          .select()
          .from(userAccount)
          .where(partner ? eq(userAccount.userAccountId, partner.userAccountId) : eq(userAccount.email, EXTERNAL_DEMO_EMAIL));
        if (!vendor) {
          res.status(500).json({ error: 'Seeded demo vendor not found; run `npm run seed` first.' });
          return;
        }
        const user: AuthenticatedUser = {
          userAccountId: vendor.userAccountId,
          email: vendor.email,
          displayName: vendor.displayName,
          authType: 'magic-link',
        };
        setSessionUser(req, user);
        res.json(user);
      }),
    );
  }

  return router;
}
