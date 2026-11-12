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
import { memoryStore } from './memoryStore';
import { signIn } from './httpHelpers';
import { recordTourRecords, sweepTourRuns, TOUR_RUN_LIFETIME_MS } from '../src/demoTour/tourRuns';
import { createDraftFromUpload, startUploadRead } from '../src/imports/splitByCase';
import { extractionsSettled } from '../src/imports/extractionJobs';
import { resolvePortalActor } from '../src/portal/portalActor';
import { document } from '../src/db/schema';
import { reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { askQuestion } from '../src/billing/reviewQuestions';
import { matchInvoiceToCase } from '../src/billing/invoiceIntake';
import { createCase } from '../src/intake/createCase';
import { ROLE_IDS } from '../src/db/syntheticIds';
import { caseDuplicateReview, caseStatuses, demoTourRun, invoiceApprovalDecision, invoiceReviewQuestion, person, professional, professionalKinds } from '../src/db/schema';

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
    // Flagged as possible double billing: the earlier weeks on its case, and the same day on another.
    const { billingOverlaps } = (await (await call('GET', `/api/invoices/${invoiceId}`)).json()) as {
      billingOverlaps: Array<{ invoiceId: string; sameCase: boolean; lines: unknown[] }>;
    };
    expect(billingOverlaps).toEqual([
      expect.objectContaining({ invoiceId: earlierInvoiceId, sameCase: true }),
      expect.objectContaining({ invoiceId: otherCaseInvoiceId, sameCase: false, lines: [expect.anything()] }),
    ]);
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

describe('removing old tour runs', () => {
  const store = memoryStore();
  const dayLater = () => new Date(Date.now() + TOUR_RUN_LIFETIME_MS + 60_000);
  const counts = async () => ({
    cases: (await testDb.select().from(caseTable)).length,
    people: (await testDb.select().from(person)).length,
    providers: (await testDb.select().from(professional)).length,
    invoices: (await testDb.select().from(invoice)).length,
    lines: (await testDb.select().from(invoiceLine)).length,
    decisions: (await testDb.select().from(invoiceApprovalDecision)).length,
    questions: (await testDb.select().from(invoiceReviewQuestion)).length,
  });

  it('removes a day-old run, with what the visitor did to it, and nothing else', async () => {
    const before = await counts();
    const { body } = await start('review');
    const invoiceId = body.run.invoiceId!;
    // What a visitor does on the tour invoice: match it, decide a line, ask about another.
    await matchInvoiceToCase(testDb, fixtures.staffUserAccountId, invoiceId, { caseId: body.run.caseId, addMissing: true });
    const lines = await testDb.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    await reviewInvoiceLine(testDb, fixtures.staffUserAccountId, invoiceId, lines[0]!.invoiceLineId, { outcome: 'approved' });
    await askQuestion(testDb, fixtures.staffUserAccountId, invoiceId, { invoiceLineId: lines[1]!.invoiceLineId, question: 'Which witnesses?' });
    expect((await counts()).invoices).toBeGreaterThan(before.invoices);

    expect(await sweepTourRuns(testDb, store)).toEqual({ removed: 0, kept: 0 });
    expect(await sweepTourRuns(testDb, store, dayLater())).toEqual({ removed: 1, kept: 0 });
    expect(await counts()).toEqual(before);
    expect(await testDb.select().from(demoTourRun)).toHaveLength(0);
    // The shared route cache stays.
    expect(await testDb.select().from(routeCheck)).toHaveLength(1);
  });

  it('removes every mission’s material', async () => {
    const before = await counts();
    for (const mission of ['staff-filing', 'preauth-send', 'review', 'answer-finish', 'sign-off']) {
      await start(mission);
    }
    expect(await sweepTourRuns(testDb, store, dayLater())).toEqual({ removed: 5, kept: 0 });
    expect(await counts()).toEqual(before);
  });

  it('removes an uploaded file with its draft, from the store too', async () => {
    const { body } = await start('preauth-send');
    const actor = await resolvePortalActor(testDb, vendorId);
    const bytes = Buffer.from(['date,type,description,hours,amount', '2026-01-10,time,Research,1.5,142.5', ''].join('\n'));
    const { uploadReadId } = await startUploadRead(testDb, store, actor, { fileName: 'invoice.csv', bytes });
    await extractionsSettled();
    const draft = await createDraftFromUpload(testDb, actor, { uploadReadId, caseId: body.run.caseId, professionalId: vendorProfessionalId });
    await recordTourRecords(testDb, body.run.runId!, [{ table: 'invoice', id: draft.invoiceId }]);
    expect(store.files.size).toBeGreaterThan(0);

    expect(await sweepTourRuns(testDb, store, dayLater())).toEqual({ removed: 1, kept: 0 });
    expect(await testDb.select().from(document)).toHaveLength(0);
    expect(store.files.size).toBe(0);
  });

  it('removes a person the visitor added in the tour, but not one added by the same account outside it', async () => {
    const { call } = await start('staff-filing');
    const [kind] = await testDb.select().from(professionalKinds).limit(1);
    const added = await call('POST', '/api/professionals', { displayName: 'Tour Added', professionalKindId: kind!.id });
    expect(added.status).toBe(201);
    const plain = await signIn(server, '/auth/demo-login', fixtures.staffUserAccountId);
    expect((await plain('POST', '/api/professionals', { displayName: 'Kept Person', professionalKindId: kind!.id })).status).toBe(201);

    await sweepTourRuns(testDb, store, dayLater());
    const names = (await testDb.select().from(person)).map((row) => row.displayName);
    expect(names).toContain('Kept Person');
    expect(names).not.toContain('Tour Added');
  });

  it('keeps a run that reaches records outside it, and says why', async () => {
    const { body } = await start('answer-finish');
    const [open] = await testDb.select().from(caseStatuses).limit(1);
    const other = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
      requestId: crypto.randomUUID(),
      newClient: { displayName: 'Not On The Tour', confirmedNew: true },
      caseNumber: '26-XX-00001',
      participantRoleId: ROLE_IDS.CLIENT_PARTICIPANT,
      statusId: open!.id,
      effectiveAt: new Date(),
    });
    const [first, second] = [body.run.caseId!, other.caseId].sort();
    await testDb.insert(caseDuplicateReview).values({
      caseId: first!,
      otherCaseId: second!,
      outcome: 'possible_duplicate',
      recordedByUserAccountId: fixtures.staffUserAccountId,
      recordedAt: new Date(),
    });
    const casesBefore = (await testDb.select().from(caseTable)).length;

    expect(await sweepTourRuns(testDb, store, dayLater())).toEqual({ removed: 0, kept: 1 });
    expect((await testDb.select().from(caseTable)).length).toBe(casesBefore);
    const [run] = await testDb.select().from(demoTourRun);
    expect(run?.keptReason).toMatch(/case/);
    // Not tried again.
    expect(await sweepTourRuns(testDb, store, dayLater())).toEqual({ removed: 0, kept: 0 });
  });
});
