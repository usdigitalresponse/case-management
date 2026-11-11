import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from './testDb';
import { buildDatabaseReport } from '../src/db/databaseReport';

afterAll(async () => {
  await testPool.end();
});

describe('database report', () => {
  it('has every section', async () => {
    const report = await buildDatabaseReport(testPool);
    expect(report).toMatch(/^# Database report\n\nPostgreSQL \d+/);
    for (const heading of ['Slowest queries', 'Tables of', 'Foreign keys with no index', 'Indexes never used']) {
      expect(report).toContain(`## ${heading}`);
    }
  });
});
