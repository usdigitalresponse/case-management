// The whole AuthenticatedUser lives in cookie-session's signed cookie; there is no server-side store.
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from './oidcProviders';

export function getSessionUser(req: Request): AuthenticatedUser | undefined {
  const user = req.session?.user as (Omit<AuthenticatedUser, 'authType'> & { authType: string }) | undefined;
  // Sessions from before sign-in moved to emailed codes still say 'magic-link'.
  return user?.authType === 'magic-link' ? { ...user, authType: 'email-code' } : (user as AuthenticatedUser | undefined);
}

// Any sign-in but a tour's own switch ends the guided tour run, so what is
// done afterwards isn't tagged to it (../demoTour/tourRuns.ts).
export function setSessionUser(req: Request, user: AuthenticatedUser, { keepTour = false } = {}): void {
  if (req.session) {
    req.session.user = user;
    if (!keepTour) delete req.session.tour;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (getSessionUser(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
}

// Gates actions only SSO staff may take. External users get the same 403 an unassigned case would, so the
// route doesn't reveal itself.
export function requireFullUser(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (user?.authType === 'sso') {
    next();
    return;
  }
  res.status(user ? 403 : 401).json({ error: user ? 'forbidden' : 'Authentication required.' });
}
