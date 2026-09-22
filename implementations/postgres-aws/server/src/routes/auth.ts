import { Router } from 'express';
import passport from 'passport';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { userAccount } from '../db/schema';
import { getSessionUser, setSessionUser } from '../auth/session';
import type { AuthenticatedUser } from '../auth/googleStrategy';
import { asyncHandler } from './asyncHandler';

export interface AuthRouterOptions {
  googleEnabled: boolean;
  // Bypasses Google entirely, logging in as the seeded synthetic staff
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

  if (options.googleEnabled) {
    router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

    router.get(
      '/google/callback',
      passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
      (req, res) => {
        setSessionUser(req, req.user as AuthenticatedUser);
        res.redirect('/');
      },
    );
  }

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
        };
        setSessionUser(req, user);
        res.json(user);
      }),
    );
  }

  return router;
}
