// Who may sign in with an emailed code: an external user whose sign-in an
// administrator turned on (model/rules.yaml manage_external_sign_in).
import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { isNotStaffRole } from './staffAccountRole';
import { normalizeEmail } from './emailLists';
import { getSessionUser } from './session';

const ON = sql`p.external_sign_in_enabled and p.merged_into_person_id is null`;

// Why this email can't be given a code, if an account already has it; null if one can.
export async function accountSignInProblem(db: DatabaseOrTransaction, rawEmail: string, personId?: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  const result = await db.execute<{ active: boolean; external: boolean; person_id: string | null }>(sql`
    select a.active, ${isNotStaffRole(sql`a.system_role_id`)} as external, a.person_id from user_account a where a.email = ${email}`);
  const [account] = result.rows;
  if (!account) return null;
  if (!account.external) return 'This email belongs to a staff account, which signs in with the organization’s account.';
  if (!account.active) return 'This email belongs to a deactivated account.';
  if (personId && account.person_id && account.person_id !== personId) return 'Someone else already signs in with this email.';
  return null;
}

// The person signing in, if this email may have a code: an account's own person once it has one, else whoever has the email.
export async function externalSignInPersonId(db: DatabaseOrTransaction, rawEmail: string): Promise<string | undefined> {
  const email = normalizeEmail(rawEmail);
  if (await accountSignInProblem(db, email)) return undefined;
  const result = await db.execute<{ person_id: string }>(sql`
    select p.person_id from person p
    where ${ON} and coalesce(
      (select a.person_id = p.person_id from user_account a where a.email = ${email} and a.person_id is not null),
      lower(p.email) = ${email})
    order by p.person_id limit 1`);
  return result.rows[0]?.person_id;
}

export async function externalSessionAllowed(db: DatabaseOrTransaction, userAccountId: string): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 from user_account ua join person p on p.person_id = ua.person_id
    where ua.user_account_id = ${userAccountId} and ua.active and ${isNotStaffRole(sql`ua.system_role_id`)} and ${ON}`);
  return result.rows.length > 0;
}

// Sessions live only in the cookie, so turning sign-in off ends one here, on its next request.
export function endTurnedOffExternalSessions(db: DatabaseOrTransaction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getSessionUser(req);
    if (user?.authType !== 'email-code') {
      next();
      return;
    }
    externalSessionAllowed(db, user.userAccountId).then(
      (allowed) => {
        if (allowed) {
          next();
          return;
        }
        req.session = null;
        res.status(401).json({ error: 'You can no longer sign in here. Ask the agency if you think this is wrong.' });
      },
      next,
    );
  };
}
