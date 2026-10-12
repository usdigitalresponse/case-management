// Gates settings to full users holding the Administrator system role
// (./staffAccountRole.ts). Read from the database on each request, unlike
// the session's identity, so granting or removing the role applies at once.
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, type DatabaseOrTransaction } from '../db/client';
import { userAccount } from '../db/schema';
import { getSessionUser } from './session';
import { getAdminAccountRoleId } from './staffAccountRole';

export async function isAdmin(database: DatabaseOrTransaction, userAccountId: string): Promise<boolean> {
  const [row] = await database
    .select({ systemRoleId: userAccount.systemRoleId, active: userAccount.active })
    .from(userAccount)
    .where(eq(userAccount.userAccountId, userAccountId));
  return Boolean(row?.active && row.systemRoleId === (await getAdminAccountRoleId(database)));
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  isAdmin(db, user.userAccountId).then(
    (admin) => {
      if (admin && user.authType === 'sso') {
        next();
      } else {
        res.status(403).json({ error: 'forbidden', message: 'Only an administrator can change settings.' });
      }
    },
    next,
  );
}
