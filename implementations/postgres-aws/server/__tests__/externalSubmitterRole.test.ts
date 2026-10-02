import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures } from '../src/db/fixtures';
import {
  getExternalSubmitterRoleId,
  EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME,
} from '../src/professionals/externalSubmitterRole';
import { role } from '../src/db/schema';

beforeEach(async () => {
  await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

describe('getExternalSubmitterRoleId', () => {
  it('returns the fixture-seeded role', async () => {
    const roleId = await getExternalSubmitterRoleId(testDb);

    const [row] = await testDb.select().from(role).where(eq(role.roleId, roleId));
    expect(row?.displayName).toBe(EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME);
    expect(row?.roleContext).toBe('case_assignment');
  });

  it('throws if the role is missing, rather than silently creating one', async () => {
    await testDb.delete(role).where(eq(role.displayName, EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME));

    await expect(getExternalSubmitterRoleId(testDb)).rejects.toThrow();
  });
});
