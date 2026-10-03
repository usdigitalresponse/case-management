import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures } from '../src/db/fixtures';
import { ensureReferenceData } from '../src/db/ensureReferenceData';
import { EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME } from '../src/professionals/externalSubmitterRole';
import { activityTypes, invoiceLineTypes, invoiceStatuses, role } from '../src/db/schema';

beforeEach(async () => {
  // The baseline already has these rows (fixtures.ts runs
  // ensureReferenceData), so a further run must be a no-op.
  await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

describe('ensureReferenceData', () => {
  it('is idempotent: running it twice creates no duplicates', async () => {
    await ensureReferenceData(testDb);
    await ensureReferenceData(testDb);

    const [activityRows, statusRows, lineTypeRows, roleRows] = await Promise.all([
      testDb.select().from(activityTypes).where(eq(activityTypes.code, 'legal_services')),
      testDb.select().from(invoiceStatuses).where(eq(invoiceStatuses.code, 'submitted')),
      testDb.select().from(invoiceLineTypes).where(eq(invoiceLineTypes.code, 'service')),
      testDb
        .select()
        .from(role)
        .where(and(eq(role.displayName, EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME), eq(role.roleContext, 'case_assignment'))),
    ]);
    expect(activityRows).toHaveLength(1);
    expect(statusRows).toHaveLength(1);
    expect(lineTypeRows).toHaveLength(1);
    expect(roleRows).toHaveLength(1);
  });

  it('creates every required row from empty, not just the role', async () => {
    await testDb.delete(activityTypes);
    await testDb.delete(invoiceStatuses);
    await testDb.delete(invoiceLineTypes);
    await testDb.delete(role).where(eq(role.displayName, EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME));

    await ensureReferenceData(testDb);

    const [activityRows, statusRows, lineTypeRows, roleRows] = await Promise.all([
      testDb.select().from(activityTypes).where(eq(activityTypes.code, 'legal_services')),
      testDb.select().from(invoiceStatuses).where(eq(invoiceStatuses.code, 'submitted')),
      testDb.select().from(invoiceLineTypes).where(eq(invoiceLineTypes.code, 'service')),
      testDb
        .select()
        .from(role)
        .where(and(eq(role.displayName, EXTERNAL_SUBMITTER_ROLE_DISPLAY_NAME), eq(role.roleContext, 'case_assignment'))),
    ]);
    expect(activityRows).toHaveLength(1);
    expect(statusRows).toHaveLength(1);
    expect(lineTypeRows).toHaveLength(1);
    expect(roleRows).toHaveLength(1);
  });
});
