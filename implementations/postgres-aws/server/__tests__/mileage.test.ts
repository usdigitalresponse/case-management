import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { submitInvoice } from '../src/billing/invoiceLifecycle';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { setBillingRule } from '../src/billing/billingRules';
import { addMileageRate } from '../src/billing/mileageRates';
import { pairKey, setRouteProviderForTests, type RouteProvider } from '../src/billing/routeCheck';
import { suggestMileage } from '../src/imports/parsedInvoice';
import { caseAssignment, routeCheck, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterEach(() => {
  setRouteProviderForTests(undefined);
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await testPool.end();
});

async function setup(): Promise<{ actor: PortalActor; caseId: string }> {
  const [account] = await testDb
    .insert(userAccount)
    .values({ displayName: 'Synthetic Investigator', email: `${randomUUID()}@example.com`, active: true })
    .returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Synthetic Investigator');
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-01T12:00:00Z'),
  });
  await testDb.insert(caseAssignment).values({
    caseId,
    professionalId,
    assignedAt: new Date('2026-01-01T12:00:00Z'),
    assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
    assignedByUserAccountId: fixtures.staffUserAccountId,
  });
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), caseId };
}

const rate = (ratePerMile: number, effectiveFrom = '2026-01-01') =>
  addMileageRate(testDb, fixtures.staffUserAccountId, { ratePerMile, effectiveFrom });

const distanceRule = (enforcement: string, tolerancePercent = 10) =>
  setBillingRule(testDb, fixtures.staffUserAccountId, 'mileage_distance', { enforcement, parameters: { tolerancePercent } });

const trip = (miles: number, extra: Record<string, unknown> = {}) => ({
  lineType: 'mileage' as const,
  serviceDate: '2026-02-02',
  description: 'Drive to courthouse',
  quantity: miles,
  tripOrigin: '100 Main Street, Springfield',
  tripDestination: '1 Court Plaza, Springfield',
  ...extra,
});

// One-way miles by destination; counts calls as a real provider would.
function fakeProvider(miles: Record<string, number | undefined>, fail = false) {
  const lookups: string[] = [];
  const provider: RouteProvider = {
    async distanceMiles(origin, destination, countCall) {
      lookups.push(`${origin} -> ${destination}`);
      countCall();
      countCall();
      if (fail) {
        throw new Error('service unavailable');
      }
      countCall();
      return miles[destination] ?? miles[origin];
    },
  };
  setRouteProviderForTests(provider);
  return lookups;
}

async function mileageLine(invoiceId: string) {
  const detail = await loadInvoiceDetail(testDb, invoiceId);
  return { line: detail!.lines.find((line) => line.expenseTypeCode === 'mileage')!, findings: detail!.ruleFindings };
}

describe('mileage items', () => {
  it('are priced as miles times the mileage rate in force on the date, to a tenth of a cent rate', async () => {
    const { actor, caseId } = await setup();
    await rate(0.655, '2025-01-01');
    await rate(0.7, '2026-02-01');
    const { invoiceId, submittedTotal } = await createInvoice(testDb, actor, {
      caseId,
      submit: false,
      lines: [trip(42.5, { amount: 999 }), { lineType: 'expense', amount: 12, description: 'Parking' }],
    });
    const { line } = await mileageLine(invoiceId);
    expect(line).toMatchObject({
      lineTypeCode: 'expense',
      quantity: '42.50',
      billedRate: '0.700',
      amount: '29.75',
      tripOrigin: '100 Main Street, Springfield',
      roundTrip: false,
    });
    expect(submittedTotal).toBe('41.75');
  });

  it('need a rate and miles before they can be submitted', async () => {
    const { actor, caseId } = await setup();
    await expect(createInvoice(testDb, actor, { caseId, lines: [trip(10)] })).rejects.toMatchObject({
      fieldErrors: { lines: expect.stringMatching(/No mileage rate is set for 2026-02-02/) },
    });
    await rate(0.7);
    await expect(createInvoice(testDb, actor, { caseId, lines: [trip(10, { quantity: undefined })] })).rejects.toMatchObject({
      fieldErrors: { lines: expect.stringMatching(/needs miles/) },
    });
  });

  it('are suggested on import for expenses described as mileage, with miles from the description', () => {
    const base = { location: 'row 2', amount: 21 };
    expect(suggestMileage({ ...base, lineType: 'expense', description: 'Mileage to jail (30 miles)' })).toMatchObject({
      lineType: 'mileage',
      quantity: 30,
    });
    expect(suggestMileage({ ...base, lineType: 'expense', description: 'Filing fee' }).lineType).toBe('expense');
    expect(suggestMileage({ ...base, lineType: 'time', description: 'Drove 30 miles' }).lineType).toBe('time');
  });
});

describe('mileage distance rule', () => {
  it('compares claims with the driving route on submission, allowing the tolerance and round trips', async () => {
    const { actor, caseId } = await setup();
    await rate(0.7);
    await distanceRule('warn', 10);
    const lookups = fakeProvider({ '1 Court Plaza, Springfield': 20 });

    const within = await createInvoice(testDb, actor, { caseId, lines: [trip(42, { roundTrip: true })] });
    expect((await mileageLine(within.invoiceId)).findings).toEqual([]);
    expect((await mileageLine(within.invoiceId)).line).toMatchObject({ routeDistance: '20.0' });

    // Same trip spelled differently and reversed: no second lookup.
    const over = await createInvoice(testDb, actor, {
      caseId,
      lines: [trip(30, { tripOrigin: '1 court plaza springfield', tripDestination: '100 Main St., Springfield, USA' })],
    });
    const { findings } = await mileageLine(over.invoiceId);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'mileage_distance',
        enforcement: 'warn',
        message: expect.stringMatching(/claims 30 mi, more than 10% over the 20 mi driving route/),
      }),
    ]);
    expect(lookups).toHaveLength(1);
  });

  it('blocks an over-claim or missing addresses only when required', async () => {
    const { actor, caseId } = await setup();
    await rate(0.7);
    await distanceRule('require', 10);
    fakeProvider({ '1 Court Plaza, Springfield': 20 });
    await expect(createInvoice(testDb, actor, { caseId, lines: [trip(30)] })).rejects.toMatchObject({
      fieldErrors: { lines: expect.stringMatching(/more than 10% over/) },
    });
    await expect(
      createInvoice(testDb, actor, { caseId, lines: [trip(10, { tripOrigin: undefined, tripDestination: undefined })] }),
    ).rejects.toMatchObject({ fieldErrors: { lines: expect.stringMatching(/needs From and To/) } });
  });

  it('leaves trips it cannot measure to the reviewer, retrying failures on the next submission', async () => {
    const { actor, caseId } = await setup();
    await rate(0.7);
    await distanceRule('require');
    fakeProvider({}, true);
    const draft = await createInvoice(testDb, actor, { caseId, submit: false, lines: [trip(500)] });
    await submitInvoice(testDb, actor, draft.invoiceId);
    expect((await mileageLine(draft.invoiceId)).line.routeDistance).toBeNull();

    const lookups = fakeProvider({});
    await createInvoice(testDb, actor, { caseId, lines: [trip(500)] });
    await createInvoice(testDb, actor, { caseId, lines: [trip(500)] });
    // Retried after the error; an address that can't be placed isn't retried.
    expect(lookups).toHaveLength(1);
  });

  it('makes no lookups while the rule is off, and stops at a monthly limit only when one is set', async () => {
    const { actor, caseId } = await setup();
    await rate(0.7);
    const lookups = fakeProvider({ '1 Court Plaza, Springfield': 20, 'Elsewhere': 5 });
    await createInvoice(testDb, actor, { caseId, lines: [trip(30)] });
    expect(lookups).toHaveLength(0);

    await distanceRule('warn');
    await testDb.insert(routeCheck).values({
      pairKey: 'earlier | lookups',
      outcome: 'found',
      distanceMiles: '1.0',
      apiCalls: 5000,
      checkedAt: new Date(),
    });
    // No limit by default, however many calls this month.
    await createInvoice(testDb, actor, { caseId, lines: [trip(30)] });
    expect(lookups).toHaveLength(1);

    vi.stubEnv('ROUTE_CHECK_MONTHLY_CALL_LIMIT', '5004');
    await createInvoice(testDb, actor, { caseId, lines: [trip(5, { tripDestination: 'Elsewhere' })] });
    expect(lookups).toHaveLength(1);
    await testDb.delete(routeCheck).where(eq(routeCheck.pairKey, 'earlier | lookups'));
    await createInvoice(testDb, actor, { caseId, lines: [trip(5, { tripDestination: 'Elsewhere' })] });
    expect(lookups).toHaveLength(2);
  });

  it('treats common spellings of an address as the same place', () => {
    expect(pairKey('100 Main Street, Springfield, USA', '1 Court Plaza')).toBe(pairKey('1 court plaza', '100 main st springfield'));
    expect(pairKey('12 North Oak Avenue 89501-1234', 'x')).toBe(pairKey('12 n oak ave 89501', 'x'));
    expect(pairKey('Same place', 'same place')).toBeUndefined();
  });
});
