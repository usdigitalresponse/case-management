import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth, requireFullUser } from '../src/auth/session';
import type { AuthenticatedUser } from '../src/auth/oidcProviders';

function mockRes() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return res as unknown as Response;
}

function mockReq(user?: AuthenticatedUser): Request {
  return { session: user ? { user } : undefined } as unknown as Request;
}

const ssoUser: AuthenticatedUser = {
  userAccountId: 'staff-1',
  email: 'staff@usdigitalresponse.org',
  displayName: 'Staff',
  authType: 'sso',
  ssoProvider: 'google',
};

const magicLinkUser: AuthenticatedUser = {
  userAccountId: 'vendor-1',
  email: 'vendor@example.com',
  displayName: 'vendor@example.com',
  authType: 'magic-link',
};

describe('requireAuth', () => {
  it('calls next for any authenticated session', () => {
    const next = vi.fn();
    requireAuth(mockReq(magicLinkUser), mockRes(), next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects an unauthenticated request with 401', () => {
    const res = mockRes();
    const next = vi.fn();
    requireAuth(mockReq(), res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireFullUser', () => {
  it('calls next for an sso-authenticated session', () => {
    const next = vi.fn();
    requireFullUser(mockReq(ssoUser), mockRes(), next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a magic-link session with 403, not 401 (they are signed in, just not allowed)', () => {
    const res = mockRes();
    const next = vi.fn();
    requireFullUser(mockReq(magicLinkUser), res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects an unauthenticated request with 401', () => {
    const res = mockRes();
    const next = vi.fn();
    requireFullUser(mockReq(), res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
