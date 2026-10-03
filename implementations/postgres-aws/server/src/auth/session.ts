// Thin session helpers over cookie-session's plain signed-cookie store (no
// server-side session store) — the whole AuthenticatedUser is small enough
// to live in the cookie itself, so there's no per-request DB lookup.
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from './oidcProviders';

export function getSessionUser(req: Request): AuthenticatedUser | undefined {
  return req.session?.user as AuthenticatedUser | undefined;
}

export function setSessionUser(req: Request, user: AuthenticatedUser): void {
  if (req.session) {
    req.session.user = user;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (getSessionUser(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
}

// Gates actions only a full (SSO-authenticated — Google, Microsoft Entra
// ID, or any other configured provider) agency user may take — e.g.
// assigning an external user to a case. An external magic-link user
// hitting one of these gets the same 403 an unassigned case would, rather
// than a route that reveals it exists only to find out they can't use it.
export function requireFullUser(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (user?.authType === 'sso') {
    next();
    return;
  }
  res.status(user ? 403 : 401).json({ error: user ? 'forbidden' : 'Authentication required.' });
}
