import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import express from 'express';
import cookieSession from 'cookie-session';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { caller, signIn, startServer, type Call, type TestServer } from './httpHelpers';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { createAuthRouter } from '../src/routes/auth';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { finishReview, signOffInvoice } from '../src/billing/reviewRounds';
import { setSignOffApprovers } from '../src/billing/reviewAssignment';
import { getReferenceId } from '../src/db/referenceLookups';
import { invoice, invoiceApprovalChain, invoiceLine, invoiceStatuses, person, userAccount } from '../src/db/schema';

let server: TestServer;
let fixtures: BaselineFixtureIds;

beforeAll(async () => {
  server = await startServer(createApp());
});

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await server.close();
  await pool.end();
  await testPool.end();
});

const asStaff = async (role: 'staff' | 'admin') => signIn(server, '/auth/demo-login', await createStaff(role));

// The partner demo sign-in takes only demo-vendor addresses.
// An external account whose person may sign in.
async function createExternalAccount() {
  const email = `demo-vendor-${randomUUID()}@example.invalid`;
  const [signedIn] = await testDb.insert(person).values({ displayName: email, email, externalSignInEnabled: true }).returning();
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true, personId: signedIn!.personId }).returning();
  return account!;
}

async function createSubmitter() {
  const account = await createExternalAccount();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account.userAccountId, account.email);
  const call = await signIn(server, '/auth/demo-login/external', account.userAccountId);
  return { userAccountId: account.userAccountId, professionalId, call };
}

async function createSubmittedInvoice(submitter: { userAccountId: string; professionalId: string }) {
  const { caseId } = await createCase(
    testDb,
    { userAccountId: fixtures.staffUserAccountId },
    {
      requestId: randomUUID(),
      personId: fixtures.clientPersonId,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-15T12:00:00Z'),
    },
  );
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: submitter.userAccountId,
      professionalId: submitter.professionalId,
      statusId: await getReferenceId(testDb, invoiceStatuses, 'submitted'),
      submittedAt: new Date(),
      submittedTotal: '70.00',
      caseId,
    })
    .returning();
  const invoiceId = row!.invoiceId;
  await testDb.insert(invoiceApprovalChain).values({ invoiceId, createdByUserAccountId: submitter.userAccountId, createdAt: new Date() });
  const [line] = await testDb
    .insert(invoiceLine)
    .values({ invoiceId, caseId, lineTypeId: fixtures.invoiceLineTypeSampleId, amount: '70.00' })
    .returning();
  return { invoiceId, lineId: line!.invoiceLineId };
}

const STAFF_ONLY = [
  '/api/cases',
  '/api/cases/counts',
  '/api/cases/overview',
  '/api/people?q=a',
  '/api/people/possible-duplicates',
  '/api/people/possible-duplicates/count',
  '/api/people/merges',
  '/api/cases/possible-duplicates',
  '/api/cases/possible-duplicates/count',
  '/api/professionals',
  '/api/staff?q=a',
  '/api/invoices',
  '/api/invoices/counts',
  '/api/reference-data',
  '/api/settings/professional-kinds',
  '/api/settings/external-users',
];

describe('signed out', () => {
  it.each([...STAFF_ONLY, '/api/my-cases', '/api/portal/invoices', '/api/preauthorizations/requests'])('refuses %s', async (path) => {
    expect((await caller(server)('GET', path)).status).toBe(401);
  });
});

describe('an external submitter', () => {
  it('is refused every staff route', async () => {
    const { call } = await createSubmitter();
    for (const path of STAFF_ONLY) {
      expect([path, (await call('GET', path)).status]).toEqual([path, 403]);
    }
  });

  it('cannot open their own invoice through the staff review route', async () => {
    const submitter = await createSubmitter();
    const { invoiceId } = await createSubmittedInvoice(submitter);
    expect((await submitter.call('GET', `/api/invoices/${invoiceId}`)).status).toBe(403);
  });

  it("cannot read, withdraw or delete another submitter's invoice", async () => {
    const owner = await createSubmitter();
    const other = await createSubmitter();
    const { invoiceId } = await createSubmittedInvoice(owner);

    expect((await owner.call('GET', `/api/portal/invoices/${invoiceId}`)).status).toBe(200);
    expect((await other.call('GET', `/api/portal/invoices/${invoiceId}`)).status).toBe(404);
    expect((await other.call('POST', `/api/portal/invoices/${invoiceId}/withdraw`, {})).status).toBe(404);
    expect((await other.call('DELETE', `/api/portal/invoices/${invoiceId}`)).status).toBe(404);
    const listed = (await (await other.call('GET', '/api/portal/invoices')).json()) as { items: unknown[] };
    expect(listed.items).toEqual([]);
  });

  it('is shown possible double billing only on invoices they may read', async () => {
    const professional = await createSubmitter();
    const { invoiceId: sentId } = await createSubmittedInvoice(professional);
    await testDb.update(invoice).set({ periodStart: '2026-03-01', periodEnd: '2026-03-15' }).where(eq(invoice.invoiceId, sentId));
    // A colleague's draft for the same professional, case and weeks.
    const colleague = await createExternalAccount();
    const [sent] = await testDb.select().from(invoice).where(eq(invoice.invoiceId, sentId));
    const [draft] = await testDb
      .insert(invoice)
      .values({
        submittedByUserAccountId: colleague.userAccountId,
        professionalId: professional.professionalId,
        statusId: await getReferenceId(testDb, invoiceStatuses, 'draft'),
        submittedTotal: '0.00',
        caseId: sent!.caseId,
        periodStart: '2026-03-10',
        periodEnd: '2026-03-31',
      })
      .returning();
    const overlapsFor = async (call: Call) =>
      ((await (await call('GET', `/api/portal/invoices/${draft!.invoiceId}`)).json()) as { billingOverlaps: Array<{ invoiceId: string }> }).billingOverlaps;

    expect((await overlapsFor(professional.call)).map((overlap) => overlap.invoiceId)).toEqual([sentId]);
    expect(await overlapsFor(await signIn(server, '/auth/demo-login/external', colleague.userAccountId))).toEqual([]);
  });

  it("is not sent a sign-off send-back comment or the reviewer's time log", async () => {
    const reviewer = await createStaff('reviewer');
    const approver = await createStaff('approver');
    const submitter = await createSubmitter();
    const { invoiceId, lineId } = await createSubmittedInvoice(submitter);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineId, { outcome: 'approved' });
    await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
    await finishReview(testDb, reviewer, invoiceId);
    await signOffInvoice(testDb, approver, invoiceId, { outcome: 'changes_requested', comment: 'Internal: check the duplicate.' });

    const staffView = await (await (await asStaff('staff'))('GET', `/api/invoices/${invoiceId}`)).text();
    expect(staffView).toContain('Internal: check the duplicate.');
    expect(JSON.parse(staffView)).toHaveProperty('timeLog');
    expect(staffView).not.toContain('"cursor"');

    const response = await submitter.call('GET', `/api/portal/invoices/${invoiceId}`);
    const submitterView = await response.text();
    expect(response.status).toBe(200);
    expect(submitterView).not.toContain('Internal: check the duplicate.');
    expect(JSON.parse(submitterView)).not.toHaveProperty('timeLog');
  });
});

describe('staff without the administrator role', () => {
  it('cannot change settings or reset the demo', async () => {
    const staff = await asStaff('staff');
    expect((await staff('POST', '/api/settings/professional-kinds', {})).status).toBe(403);
    expect((await staff('POST', '/api/settings/demo/reset', {})).status).toBe(403);
    // The same request passes the gate for an administrator and fails on its content.
    expect((await (await asStaff('admin'))('POST', '/api/settings/professional-kinds', {})).status).toBe(400);
  });

  it("reads external users but can't search, add or turn their sign-in on or off", async () => {
    const staff = await asStaff('staff');
    const admin = await asStaff('admin');
    const { userAccountId } = await createSubmitter();
    const [{ personId }] = (await testDb.select({ personId: userAccount.personId }).from(userAccount).where(eq(userAccount.userAccountId, userAccountId))) as [{ personId: string }];
    expect((await staff('GET', '/api/settings/external-users')).status).toBe(200);
    for (const [method, path] of [
      ['GET', '/api/settings/external-users/candidates?q=a'],
      ['GET', '/api/settings/external-users/offices'],
      ['POST', '/api/settings/external-users'],
      ['PUT', `/api/settings/external-users/${personId}`],
      ['POST', `/api/settings/external-users/${personId}/offices`],
    ] as const) {
      const body = method === 'GET' ? undefined : {};
      expect([path, (await staff(method, path, body)).status]).toEqual([path, 403]);
      expect([path, (await admin(method, path, body)).status]).toEqual([path, method === 'GET' ? 200 : 400]);
    }
    const end = `/api/settings/external-users/${personId}/offices/${fixtures.officeId}/end`;
    expect((await staff('POST', end, {})).status).toBe(403);
    expect((await admin('POST', end, {})).status).toBe(404);
  });
});

describe('an external user whose sign-in is turned off', () => {
  it('is signed out on their next request', async () => {
    const submitter = await createSubmitter();
    const [{ personId }] = (await testDb.select({ personId: userAccount.personId }).from(userAccount).where(eq(userAccount.userAccountId, submitter.userAccountId))) as [{ personId: string }];
    expect((await submitter.call('GET', '/api/portal/invoices')).status).toBe(200);
    expect((await (await asStaff('admin'))('PUT', `/api/settings/external-users/${personId}`, { signInEnabled: false })).status).toBe(200);
    expect((await submitter.call('GET', '/api/portal/invoices')).status).toBe(401);
    expect((await submitter.call('GET', '/auth/me')).status).toBe(401);
  });
});

describe('long lists', () => {
  it('come a batch at a time to staff, and refuse a bad filter or position', async () => {
    const staff = await asStaff('staff');
    for (const path of [
      '/api/invoices?view=open&show=flagged&sort=newest&county=grouped',
      '/api/invoices?view=lines_decided&show=month&sort=finished&limit=1',
      '/api/cases?show=open&stage=billing&q=a',
      '/api/professionals?q=a',
      '/api/professionals/people?role=none',
      '/api/people?q=a',
      '/api/preauthorizations/requests?status=submitted',
    ]) {
      const response = await staff('GET', path);
      const text = await response.text();
      const body = JSON.parse(text) as { items?: unknown[]; next?: unknown };
      expect([path, response.status, Array.isArray(body.items), 'next' in body]).toEqual([path, 200, true, true]);
      // A row's cursor only makes `next`; it is never sent.
      expect([path, text.includes('"cursor"')]).toEqual([path, false]);
    }
    for (const path of ['/api/invoices?caseId=nope', '/api/invoices?limit=0', '/api/invoices?after=nope', '/api/cases?county=nope']) {
      expect([path, (await staff('GET', path)).status]).toEqual([path, 400]);
    }
  });
});

describe('merging people', () => {
  it('is for administrators; any staff member may flag or dismiss a pair', async () => {
    const staff = await asStaff('staff');
    const body = { keptPersonId: fixtures.clientPersonId, retiredPersonIds: [fixtures.staffPersonId] };
    expect((await staff('POST', '/api/people/merges', body)).status).toBe(403);
    expect((await staff('POST', '/api/people/merges/undo', { personMergeIds: [randomUUID()] })).status).toBe(403);
    expect((await staff('GET', `/api/people/merge-preview?keep=${body.keptPersonId}&retire=${fixtures.staffPersonId}`)).status).toBe(200);
    const pair = { personIds: [fixtures.clientPersonId, fixtures.staffPersonId] };
    expect((await staff('POST', '/api/people/possible-duplicates', { ...pair, outcome: 'possible_duplicate' })).status).toBe(204);
    expect((await staff('POST', '/api/people/possible-duplicates', { ...pair, outcome: 'not_duplicate' })).status).toBe(204);
    const admin = await asStaff('admin');
    expect((await admin('POST', '/api/people/merges/undo', { personMergeIds: [randomUUID()] })).status).toBe(404);
    expect((await admin('POST', '/api/people/merges', body)).status).toBe(201);
  });

  it('is refused to external submitters', async () => {
    const { call } = await createSubmitter();
    expect((await call('POST', '/api/people/possible-duplicates', { personIds: [fixtures.clientPersonId, fixtures.staffPersonId], outcome: 'not_duplicate' })).status).toBe(403);
    expect((await call('POST', '/api/people/merges', {})).status).toBe(403);
  });
});

describe('demo sign-ins turned off', () => {
  let off: TestServer;
  let call: Call;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieSession({ name: 'session', secret: 'test' }));
    app.use('/auth', createAuthRouter({ oidcProviders: [], demoLoginEnabled: false, externalDemoLoginEnabled: false }));
    off = await startServer(app);
    call = caller(off);
  });

  afterAll(() => off.close());

  it('has no demo sign-in routes', async () => {
    expect((await call('POST', '/auth/demo-login', {})).status).toBe(404);
    expect((await call('POST', '/auth/demo-login/external', {})).status).toBe(404);
    expect((await call('GET', '/auth/demo-accounts')).status).toBe(404);
  });
});
