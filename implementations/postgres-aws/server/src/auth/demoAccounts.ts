// The seeded synthetic accounts the demo sign-ins may act as, so a demo can
// try each role's view (MAPPING.md "Demo sign-in"). Only accounts on the
// reserved example.invalid domain qualify; real accounts never do.
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { professional, professionalKinds, role, userAccount } from '../db/schema';
import { EXTERNAL_DEMO_EMAIL } from '../db/demoAccounts';
import { getStaffAccountRoleIds } from './staffAccountRole';

const DEMO_DOMAIN = '%@example.invalid';
const DEMO_VENDOR_EMAILS = 'demo-vendor-%@example.invalid';
export const STAFF_DEMO_EMAIL = 'staff@example.invalid';

export interface DemoAccount {
  userAccountId: string;
  displayName: string;
  // The role (staff) or kind of work (partners) to show beside the name.
  description: string | null;
}

// userAccountId: just that account, if it is one of them.
export async function listDemoStaff(db: DatabaseOrTransaction, userAccountId?: string): Promise<DemoAccount[]> {
  const staffRoleIds = await getStaffAccountRoleIds(db);
  if (staffRoleIds.length === 0) {
    return [];
  }
  return db
    .select({ userAccountId: userAccount.userAccountId, displayName: userAccount.displayName, description: role.displayName })
    .from(userAccount)
    .innerJoin(role, eq(userAccount.systemRoleId, role.roleId))
    .where(
      and(
        eq(userAccount.active, true),
        like(userAccount.email, DEMO_DOMAIN),
        inArray(userAccount.systemRoleId, staffRoleIds),
        userAccountId ? eq(userAccount.userAccountId, userAccountId) : undefined,
      ),
    )
    .orderBy(asc(role.displayName), asc(userAccount.displayName));
}

export async function listDemoPartners(db: DatabaseOrTransaction, userAccountId?: string): Promise<DemoAccount[]> {
  const rows = await db
    .select({
      userAccountId: userAccount.userAccountId,
      displayName: userAccount.displayName,
      email: userAccount.email,
      kind: professionalKinds.displayName,
    })
    .from(userAccount)
    .leftJoin(professional, eq(professional.userAccountId, userAccount.userAccountId))
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(
      and(
        eq(userAccount.active, true),
        like(userAccount.email, DEMO_VENDOR_EMAILS),
        userAccountId ? eq(userAccount.userAccountId, userAccountId) : undefined,
      ),
    )
    .orderBy(asc(userAccount.email));
  return rows.map(({ email, kind, ...row }) => ({
    ...row,
    // The first demo vendor also bills for its office colleagues.
    description: [kind, email === EXTERNAL_DEMO_EMAIL ? 'office billing delegate' : null].filter(Boolean).join(', ') || null,
  }));
}
