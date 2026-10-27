import { Router } from 'express';
import { z } from 'zod';
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
import { issueSignInCode, verifySignInCode } from '../auth/signInCode';
import { ensureUserAccountForEmail } from '../auth/userAccounts';
import { ensureProfessionalForUserAccount } from '../professionals/ensureProfessional';
import { delegateOfficeIds, isStaffAccount } from '../portal/portalActor';
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
    '/code/request',
    asyncHandler(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      // Always respond the same way whether or not the email is
      // whitelisted, so this endpoint can't be used to enumerate which
      // external addresses are allowed in.
      if (email && isWhitelistedExternalEmail(email)) {
        const code = await issueSignInCode(db, email);
        // Not awaited: the response below is identical either way, so
        // there's no reason to hold the request open for an SES round
        // trip. Send failures are logged, never surfaced to the caller.
        sendEmail(
          email,
          `Your sign-in code: ${code}`,
          `Your code to sign in and send invoices is ${code}. It works once, for the next 10 minutes.\n\n` +
            'If you did not ask for it, you can ignore this email.',
        ).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('Failed to send sign-in code email:', error);
        });
      }
      res.status(202).json({ message: 'If that email is on file, a sign-in code has been sent.' });
    }),
  );

  router.post(
    '/code/verify',
    asyncHandler(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const verified = email && code ? await verifySignInCode(db, email, code) : undefined;
      // Rechecked: the address may have been taken off the list since.
      if (!verified || !isWhitelistedExternalEmail(verified)) {
        res.status(401).json({ error: 'That code is wrong or has expired. After 5 wrong codes you need a new one.' });
        return;
      }

      const account = await ensureUserAccountForEmail(db, verified);
      // A delegate acts for others and needs no professional profile of
      // their own (model/rules.yaml authorize_delegated_submission).
      if ((await delegateOfficeIds(db, account.userAccountId)).length === 0) {
        await ensureProfessionalForUserAccount(db, account.userAccountId, account.displayName);
      }

      const user: AuthenticatedUser = {
        userAccountId: account.userAccountId,
        email: account.email,
        displayName: account.displayName,
        authType: 'email-code',
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
      // A session outlives deactivation; end it on the next load.
      const [account] = await db.select({ active: userAccount.active }).from(userAccount).where(eq(userAccount.userAccountId, user.userAccountId));
      if (!account?.active) {
        req.session = null;
        res.status(401).json({ error: 'This account has been deactivated.' });
        return;
      }
      // Shows or hides Settings and review actions; the routes check them themselves.
      const staff = user.authType === 'sso';
      const [admin, reviewPermissions, staffRole] = staff
        ? await Promise.all([
            isAdmin(db, user.userAccountId),
            loadReviewPermissions(db, user.userAccountId),
            isStaffAccount(db, user.userAccountId),
          ])
        : [false, null, false];
      res.json({ ...user, isAdmin: admin, isStaff: staffRole, reviewPermissions, demoMode: options.demoLoginEnabled });
    }),
  );

  if (options.demoLoginEnabled || options.externalDemoLoginEnabled) {
    // Whom each demo sign-in may act as.
    router.get(
      '/demo-accounts',
      asyncHandler(async (_req, res) => {
        const [staff, partners] = await Promise.all([
          options.demoLoginEnabled ? listDemoStaff(db) : [],
          options.externalDemoLoginEnabled ? listDemoPartners(db) : [],
        ]);
        res.json({ staff, partners });
      }),
    );
  }

  // Signs in as the chosen demo account, which must be on `list`, else the
  // default one.
  const demoLogin = (
    path: string,
    list: typeof listDemoStaff,
    defaultEmail: string,
    authType: AuthenticatedUser['authType'],
    who: string,
  ) =>
    router.post(
      path,
      asyncHandler(async (req, res) => {
        const chosen = (req.body as { userAccountId?: unknown } | undefined)?.userAccountId;
        let accountId: string | undefined;
        if (chosen !== undefined && chosen !== '') {
          const [listed] = z.uuid().safeParse(chosen).success ? await list(db, chosen as string) : [];
          if (!listed) {
            res.status(400).json({ error: `Choose one of the demo ${who} accounts.` });
            return;
          }
          accountId = listed.userAccountId;
        }
        const [account] = await db
          .select()
          .from(userAccount)
          .where(accountId ? eq(userAccount.userAccountId, accountId) : eq(userAccount.email, defaultEmail));
        if (!account) {
          res.status(500).json({ error: `Seeded demo ${who} account not found; run \`npm run seed\` first.` });
          return;
        }
        const user: AuthenticatedUser = {
          userAccountId: account.userAccountId,
          email: account.email,
          displayName: account.displayName,
          authType,
        };
        setSessionUser(req, user);
        res.json(user);
      }),
    );

  if (options.demoLoginEnabled) {
    demoLogin('/demo-login', listDemoStaff, STAFF_DEMO_EMAIL, 'sso', 'staff');
  }
  if (options.externalDemoLoginEnabled) {
    demoLogin('/demo-login/external', listDemoPartners, EXTERNAL_DEMO_EMAIL, 'email-code', 'partner');
  }

  return router;
}
