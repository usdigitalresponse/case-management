// docs/api.md "Guided tour": each mission makes its own material and signs
// in as its first role; the tour switches only between its demo accounts.
import express from 'express';
import cookieSession from 'cookie-session';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { caller, startServer, type Call, type TestServer } from './httpHelpers';
import { createStaff } from './reviewHelpers';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { createAuthRouter } from '../src/routes/auth';
import { addDemoTourRoutes, sampleInvoiceFile } from '../src/routes/demoTour';
import { RateLimiter } from '../src/auth/rateLimit';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getBillingRules } from '../src/billing/billingRules';
import { caseTable, invoice, invoiceLine, invoiceStatuses, routeCheck, userAccount } from '../src/db/schema';
import { setRouteProviderForTests } from '../src/billing/routeCheck';
import { addMileageRate } from '../src/billing/mileageRates';
import { giveRate } from './rateHelpers';

let server: TestServer;
let fixtures: BaselineFixtureIds;
let vendorId: string;
let vendorProfessionalId: string;
let directorId: string;
let lookups = 0;

beforeAll(async () => {
  server = await startServer(createApp());
});

async function addVendor() {
  const email = 'demo-vendor-1@example.invalid';
  const [account] = await testDb.insert(userAccount).values({ displayName: 'Demo Investigator', email, active: true }).returning();
  vendorId = account!.userAccountId;
  vendorProfessionalId = await ensureProfessionalForUserAccount(testDb, vendorId, email);
}

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  await addVendor();
  await giveRate(testDb, fixtures.staffUserAccountId, vendorProfessionalId, 95);
  await addMileageRate(testDb, fixtures.staffUserAccountId, { ratePerMile: 0.7, effectiveFrom: '2025-01-01' });
  directorId = await createStaff('approver');
  lookups = 0;
  setRouteProviderForTests({
    distanceMiles: async () => {
      lookups += 1;
      return 1;
    },
  });
});

afterAll(async () => {
  setRouteProviderForTests(undefined);
  await server.close();
  await pool.end();
  await testPool.end();
});

interface Started {
  run: Record<string, string>;
  suggestions: Record<string, unknown>;
  user: { userAccountId: string; authType: string };
  role: string;
}

// Starts a mission and returns a caller holding the tour's session.
async function start(mission: string): Promise<{ call: Call; body: Started }> {
  const response = await caller(server)('POST', '/auth/demo-tour/start', { mission });
  if (response.status !== 201) throw new Error(await response.text());
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  return { call: caller(server, cookie), body: (await response.json()) as Started };
}

const statusOf = async (invoiceId: string) =>
  (
    await testDb
      .select({ code: invoiceStatuses.code })
      .from(invoice)
      .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
      .where(eq(invoice.invoiceId, invoiceId))
  )[0]?.code;

describe('guided tour', () => {
  it('starts staff filing as the staff demo account, with a paper invoice to copy and nothing made', async () => {
    const { call, body } = await start('staff-filing');
    expect(body.user.userAccountId).toBe(fixtures.staffUserAccountId);
    expect(body.role).toBe('staff');
    expect(body.suggestions.billedBy).toBe('Demo Investigator');
    expect(Array.isArray(body.suggestions.lines)).toBe(true);
    expect((await call('GET', '/auth/me')).status).toBe(200);
    expect(await testDb.select().from(invoice)).toHaveLength(0);
  });

  it('makes review material on its own case without a route lookup or changing rule settings', async () => {
    const rulesBefore = await getBillingRules(testDb);
    const { call, body } = await start('review');
    const { invoiceId, earlierInvoiceId, otherCaseInvoiceId } = body.run;
    expect(await statusOf(invoiceId!)).not.toBe('draft');
    expect((await call('GET', `/api/invoices/${invoiceId}`)).status).toBe(200);
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId!));
    // The trip's travel time, miles and parking stay separate lines, linked as one trip.
    const tripLines = lines.filter((line) => line.tripId);
    expect(tripLines).toHaveLength(3);
    expect(new Set(tripLines.map((line) => line.tripId)).size).toBe(1);
    expect(earlierInvoiceId).toBeTruthy();
    expect(otherCaseInvoiceId).toBeTruthy();
    const [cached] = await testDb.select().from(routeCheck);
    expect(cached?.apiCalls).toBe(0);
    expect(lookups).toBe(0);
    expect(await getBillingRules(testDb)).toEqual(rulesBefore);
  });

  it('waits on an answer for answer-and-finish, and signs in as the vendor', async () => {
    const { body } = await start('answer-finish');
    expect(body.user.authType).toBe('email-code');
    expect(body.role).toBe('vendor');
    expect(await statusOf(body.run.invoiceId!)).toBe('awaiting_answer');
  });

  it('leaves sign-off to a Director other than the reviewer', async () => {
    const { body } = await start('sign-off');
    expect(body.user.userAccountId).toBe(directorId);
    expect(await statusOf(body.run.invoiceId!)).toBe('awaiting_sign_off');
  });

  it('refuses missions that need a Director when there is no second staff member', async () => {
    await testDb.update(userAccount).set({ active: false }).where(eq(userAccount.userAccountId, directorId));
    const response = await caller(server)('POST', '/auth/demo-tour/start', { mission: 'sign-off' });
    expect(response.status).toBe(409);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });

  it('leaves nothing behind when making the material fails part-way', async () => {
    // Without a rate the investigator's time can't be priced, so the first invoice fails after its case is made.
    fixtures = await resetAndSeedBaselineFixtures(testDb);
    await addVendor();
    await expect(caller(server)('POST', '/auth/demo-tour/start', { mission: 'review' })).resolves.toHaveProperty('status', 400);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });

  it('switches only between its own accounts', async () => {
    const { call, body } = await start('preauth-send');
    expect(body.user.userAccountId).toBe(vendorId);
    const switched = await call('POST', '/auth/demo-tour/switch', { role: 'staff' });
    expect(((await switched.json()) as { userAccountId: string }).userAccountId).toBe(fixtures.staffUserAccountId);
    expect((await call('POST', '/auth/demo-tour/switch', { role: 'admin' })).status).toBe(400);
    expect((await caller(server)('POST', '/auth/demo-tour/switch', { role: 'staff' })).status).toBe(400);
  });

  it('serves the run’s sample invoice, and only to that run', async () => {
    const { call } = await start('preauth-send');
    const response = await call('GET', '/auth/demo-tour/sample-invoice.pdf');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect((await caller(server)('GET', '/auth/demo-tour/sample-invoice.pdf')).status).toBe(404);
  });

  it('dates the sample invoice’s lines within its billing period', () => {
    const file = sampleInvoiceFile({
      runId: 'r',
      mission: 'preauth-send',
      accounts: { staff: 's', director: 'd', vendor: 'v' },
      vendorName: 'Demo Investigator',
      sample: { invoiceNumber: 'INV-1', periodStart: '2026-10-01', periodEnd: '2026-10-31' },
    });
    const dates = file.items.flatMap((item) => (item.date ? [item.date] : []));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((date) => date >= '2026-10-01' && date <= '2026-10-31')).toBe(true);
  });

  it('refuses an unknown mission', async () => {
    expect((await caller(server)('POST', '/auth/demo-tour/start', { mission: 'everything' })).status).toBe(400);
  });
});

describe('guided tour starts over the limit', () => {
  let full: TestServer;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieSession({ name: 'session', secret: 'test' }));
    const router = express.Router();
    addDemoTourRoutes(router, new (class extends RateLimiter {
      take() {
        return false;
      }
    })());
    app.use('/auth', router);
    full = await startServer(app);
  });

  afterAll(() => full.close());

  it('are refused before anything is made', async () => {
    expect((await caller(full)('POST', '/auth/demo-tour/start', { mission: 'review' })).status).toBe(429);
    expect(await testDb.select().from(caseTable)).toHaveLength(0);
  });
});

describe('guided tour with one demo sign-in off', () => {
  let off: TestServer;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieSession({ name: 'session', secret: 'test' }));
    app.use('/auth', createAuthRouter({ oidcProviders: [], demoLoginEnabled: true, externalDemoLoginEnabled: false }));
    off = await startServer(app);
  });

  afterAll(() => off.close());

  it('has no tour routes', async () => {
    expect((await caller(off)('POST', '/auth/demo-tour/start', { mission: 'review' })).status).toBe(404);
  });
});
