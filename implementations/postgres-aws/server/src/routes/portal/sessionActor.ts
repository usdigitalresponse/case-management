// The signed-in portal user as an actor.
import { type Request } from 'express';
import { db } from '../../db/client';
import { getSessionUser } from '../../auth/session';
import { UnauthenticatedError } from '../../errors';
import { resolvePortalActor, type PortalActor } from '../../portal/portalActor';

export async function sessionActor(req: Request): Promise<PortalActor> {
  const user = getSessionUser(req);
  if (!user) {
    throw new UnauthenticatedError();
  }
  return resolvePortalActor(db, user.userAccountId);
}
