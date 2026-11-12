// Cases a batch at a time (../src/cases/caseBatches.ts) against the cases themselves.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { caseAssignment, caseTable, person, professional, county } from '../src/db/schema';
import { caseCounts, listCaseBatch, type CaseBatchRequest } from '../src/cases/caseBatches';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function addCase(clientName: string, values: Partial<typeof caseTable.$inferInsert> = {}): Promise<string> {
  const personId = randomUUID();
  await testDb.insert(person).values({ personId, displayName: clientName });
  const caseId = randomUUID();
  await testDb.insert(caseTable).values({ caseId, clientId: personId, statusId: fixtures.caseStatusOpenId, ...values });
  return caseId;
}

// Every batch, two at a time, so each cursor is used.
async function allBatches(request: CaseBatchRequest) {
  const ids: string[] = [];
  let after: string[] | null = null;
  for (let batches = 0; batches < 50; batches += 1) {
    const batch = await listCaseBatch(testDb, request, { limit: 2, after });
    ids.push(...batch.items.map((row) => row.caseId));
    if (!batch.next) break;
    after = JSON.parse(Buffer.from(batch.next, 'base64url').toString());
  }
  return ids;
}

describe('cases a batch at a time', () => {
  it('lists, filters and counts cases in client-name order', async () => {
    const [other] = await testDb.insert(county).values({ displayName: 'Synthetic County', active: true }).returning();
    const alder = await addCase('Alder Example', { countyId: fixtures.countyId, externalReference: 'SYN-100' });
    const birch = await addCase('Birch Example', { countyId: other!.countyId });
    const cedar = await addCase('Cedar Example', { closedOn: '2026-01-02' });
    const dogwood = await addCase('Dogwood Example', { countyId: fixtures.countyId });
    const elm = await addCase('Elm Example');
    const workerPersonId = randomUUID();
    await testDb.insert(person).values({ personId: workerPersonId, displayName: 'Worker Synthetic' });
    const [worker] = await testDb.insert(professional).values({ personId: workerPersonId, displayName: 'Worker Synthetic' }).returning();
    await testDb.insert(caseAssignment).values({ caseId: elm, professionalId: worker!.professionalId, assignmentRoleId: fixtures.assignedStaffRoleId, assignedAt: new Date(), assignedByUserAccountId: fixtures.staffUserAccountId });

    const ours = new Set([alder, birch, cedar, dogwood, elm]);
    const listed = async (request: CaseBatchRequest) => (await allBatches(request)).filter((id) => ours.has(id));
    expect(await listed({})).toEqual([alder, birch, cedar, dogwood, elm]);
    expect(await listed({ show: 'open' })).toEqual([alder, birch, dogwood, elm]);
    expect(await listed({ show: 'closed' })).toEqual([cedar]);
    expect(await listed({ county: fixtures.countyId })).toEqual([alder, dogwood]);
    expect(await listed({ county: 'none' })).toEqual([cedar, elm]);
    expect(await listed({ q: 'syn-100' })).toEqual([alder]);
    expect(await listed({ q: 'worker synth' })).toEqual([elm]);
    expect(await listed({ stage: 'represented' })).toEqual([alder, birch, dogwood, elm]);
    // Grouped: settings, then counties by name, then none.
    const grouped = await listed({ county: 'grouped' });
    expect(grouped.slice(-2)).toEqual([cedar, elm]);

    const { summary } = await listCaseBatch(testDb, { show: 'open' }, { limit: 1, after: null });
    const counts = await caseCounts(testDb);
    expect(summary?.counts).toEqual({ all: counts.all, open: counts.open, closed: counts.closed });
    expect(summary?.counties.find((row) => row.countyId === other!.countyId)?.count).toBe(1);
  });
});
