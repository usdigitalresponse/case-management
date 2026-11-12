// Times the cross-checks at volume; see ../../README.md "Performance tests".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, isNotNull, TransactionRollbackError } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { invoiceImport, professional } from '../src/db/schema';
import { addKindRate, createKind } from '../src/billing/professionalRates';
import { createApp } from '../src/app';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { listReviewQueueBatch, type QueueBatchRequest } from '../src/billing/reviewQueueBatches';
import { listCaseBatch } from '../src/cases/caseBatches';
import { listPeopleBatch } from '../src/professionals/peopleDirectory';
import { BATCH_SIZE } from '../src/lists/batches';
import { caseNumberMatchesFor, sentCaseNumberCounts } from '../src/billing/caseNumberMatches';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { findBillingOverlaps } from '../src/billing/billingOverlaps';
import { evaluateBillingRules, setBillingRule, BILLING_RULES, type RuleCode } from '../src/billing/billingRules';
import { sameDayTravel } from '../src/billing/sameDayTravel';
import { findOverrun } from '../src/billing/overrunExplanation';
import { preauthorizationUsageByCounty } from '../src/billing/preauthorizationUsage';
import { listInvoiceIntake } from '../src/billing/invoiceIntake';
import { findCasesByNumber } from '../src/cases/casesByNumber';
import { listPossibleDuplicateCases } from '../src/cases/possibleDuplicateCases';
import { listPossibleDuplicates } from '../src/people/possibleDuplicates';
import { emailInUse } from '../src/people/emails';
import { duplicateWarnings, recheckDuplicates } from '../src/imports/duplicateWarnings';
import { suggestUploadCase, uploadCases } from '../src/imports/caseSuggestions';
import { splitCases } from '../src/imports/splitByCase';
import { createInvoice } from '../src/portal/createInvoice';
import { listPortalInvoices } from '../src/portal/listPortalInvoices';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { giveRole } from '../__tests__/reviewHelpers';
import { signIn, startServer, type Call, type TestServer } from '../__tests__/httpHelpers';
import { testPool } from '../__tests__/testDb';
import { countQueries, measure, queryCountChanges, regressions, writeReport } from './measure';
import {
  caseOfInvoice,
  caseReference,
  filedByPerson,
  firstProfessionalOfCase,
  invoiceStatus,
  loadVolume,
  perfId,
  preauthorizedCase,
  volumeFor,
  type Volume,
} from './volume';

countQueries(pool);

const scale = Number(process.env.PERF_SCALE ?? 1);
const volume: Volume = volumeFor(scale);
const invoiceCount = volume.cases * volume.invoicesPerCase;

let fixtures: BaselineFixtureIds;
let server: TestServer;
let staffCall: Call;
let submitter: PortalActor;
let submitterCall: Call;

// As volume.ts assigns it.
function professionalOfInvoice(g: number): number {
  const c = caseOfInvoice(volume, g);
  const second = 1 + ((c * 7 + 1) % volume.professionals);
  return g % 4 === 0 && c % 3 === 0 && second !== firstProfessionalOfCase(volume, c) ? second : firstProfessionalOfCase(volume, c);
}

function firstInvoice(test: (g: number) => boolean): number {
  for (let g = 1; g <= invoiceCount; g += 1) {
    if (test(g)) return g;
  }
  throw new Error('No generated invoice fits.');
}

const inReview = firstInvoice((g) => invoiceStatus(g) === 'submitted' && !filedByPerson(g));
const byPerson = firstInvoice((g) => filedByPerson(g) && ['submitted', 'under_review', 'awaiting_sign_off'].includes(invoiceStatus(g)));
const draft = firstInvoice((g) => invoiceStatus(g) === 'draft' && !filedByPerson(g));
const repeatedFile = firstInvoice((g) => g % 60 === 0 && g > volume.cases && (g - volume.cases) % 2 === 0 && professionalOfInvoice(g) === professionalOfInvoice(g - volume.cases));
const repeatedNumber = firstInvoice(
  (g) => g % 45 === 0 && g % 2 === 0 && g > volume.cases && (g - volume.cases) % 2 === 0 && professionalOfInvoice(g) === professionalOfInvoice(g - volume.cases),
);

const header = async (g: number) => {
  const detail = await loadInvoiceDetail(db, perfId('invoice', g), 'staff');
  if (!detail) throw new Error(`Generated invoice ${g} is missing.`);
  return detail;
};

beforeAll(async () => {
  fixtures = await resetAndSeedBaselineFixtures(db);
  await giveRole(fixtures.staffUserAccountId, 'admin');
  await loadVolume(pool, fixtures, volume);
  // One kind of work with an hourly rate, so sent time can be priced.
  const { professionalKindId } = await createKind(db, { displayName: 'Synthetic investigator' });
  await addKindRate(db, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 150, effectiveFrom: '2025-01-01' });
  await db.update(professional).set({ professionalKindId }).where(isNotNull(professional.professionalId));
  // Every rule on, so each one's queries run.
  for (const code of Object.keys(BILLING_RULES) as RuleCode[]) {
    await setBillingRule(db, fixtures.staffUserAccountId, code, { enforcement: 'warn' });
  }
  submitter = await resolvePortalActor(db, perfId('pro-account', professionalOfInvoice(draft)));
  server = await startServer(createApp());
  staffCall = await signIn(server, '/auth/demo-login', fixtures.staffUserAccountId);
  submitterCall = await signIn(server, '/auth/demo-login/external', submitter.userAccountId);
});

function everyTestPassed(task: { type: string; result?: { state?: string }; tasks?: unknown[] }): boolean {
  return task.type === 'test' ? task.result?.state === 'pass' : (task.tasks ?? []).every((child) => everyTestPassed(child as typeof task));
}

// eslint-disable-next-line no-empty-pattern -- vitest requires a destructured first argument
afterAll(async ({}, file) => {
  try {
    process.stdout.write(`\n${writeReport({ ...volume, scale, invoices: invoiceCount, lines: invoiceCount * volume.linesPerInvoice }, everyTestPassed(file))}\n\n`);
  } finally {
    await server?.close();
    await pool.end();
    await testPool.end();
  }
});

const json = async (response: Response) => {
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
};

describe('review', () => {
  it('review page, as the route loads it', async () => {
    const { result } = await measure('review', 'GET /api/invoices/:id', async () => json(await staffCall('GET', `/api/invoices/${perfId('invoice', inReview)}`)));
    expect(result.billingOverlaps).toBeInstanceOf(Array);
  });

  it('invoice detail', async () => {
    const { result } = await measure('review', 'loadInvoiceDetail', () => header(inReview));
    expect(result.lines).toHaveLength(volume.linesPerInvoice);
  });

  it('possible double billing', async () => {
    const { result } = await measure('review', 'findBillingOverlaps', () => findBillingOverlaps(db, perfId('invoice', inReview)));
    expect(result.length).toBeGreaterThan(0);
  });

  it('billing rules, every rule on', async () => {
    const { result } = await measure('review', 'evaluateBillingRules', () => evaluateBillingRules(db, perfId('invoice', inReview)));
    expect(result.length).toBeGreaterThan(0);
  });

  it('same-day travel on other cases', async () => {
    const detail = await header(inReview);
    const { result } = await measure('review', 'sameDayTravel', () => sameDayTravel(db, detail.invoice, detail.lines));
    expect(result).toBeInstanceOf(Array);
  });

  it('case number counts across every sent invoice, as the queue loads them', async () => {
    const { result } = await measure('review', 'sentCaseNumberCounts', () => sentCaseNumberCounts(db));
    expect(result(caseReference(caseOfInvoice(volume, inReview))).same).toBeGreaterThan(0);
  });

  it("one invoice's case number matches, as the review page loads them", async () => {
    const { result } = await measure('review', 'caseNumberMatchesFor', () => caseNumberMatchesFor(db, perfId('invoice', inReview)));
    expect(result.same).toBeGreaterThan(0);
  });

  it('cases with the typed case number', async () => {
    const { result } = await measure('review', 'findCasesByNumber', () => findCasesByNumber(db, caseReference(caseOfInvoice(volume, byPerson))));
    expect(result.length).toBeGreaterThan(0);
  });

  it('pre-authorization overrun', async () => {
    const g = firstInvoice((n) => preauthorizedCase(caseOfInvoice(volume, n)) && professionalOfInvoice(n) === firstProfessionalOfCase(volume, caseOfInvoice(volume, n)) && !filedByPerson(n) && invoiceStatus(n) === 'submitted');
    const { result } = await measure('review', 'findOverrun', () => findOverrun(db, perfId('invoice', g), true));
    expect(result === null || typeof result.total === 'string').toBe(true);
  });

  for (const view of ['open', 'all'] as const) {
    it(`queue: ${view}`, async () => {
      const { result } = await measure('review', `listReviewQueue ${view}`, () => listReviewQueue(db, view, { actorUserAccountId: fixtures.staffUserAccountId }));
      expect(result.invoices.length).toBeGreaterThan(0);
    });
  }

  it('queue: searched by case number', async () => {
    const q = caseReference(caseOfInvoice(volume, inReview));
    const { result } = await measure('review', 'listReviewQueue open q', () => listReviewQueue(db, 'open', { q, actorUserAccountId: fixtures.staffUserAccountId }));
    expect(result.invoices.length).toBeGreaterThan(0);
  });

  it('queue: one day', async () => {
    const day = (await header(inReview)).lines[0]!.serviceDate!;
    const { result } = await measure('review', 'listReviewQueue open day', () => listReviewQueue(db, 'open', { day, actorUserAccountId: fixtures.staffUserAccountId }));
    expect(result.invoices.length).toBeGreaterThan(0);
  });

  // As the pages load them now: a first batch with its summary (../src/lists/batches.ts).
  const toReview = ['all', 'mine', 'unassigned', 'flagged'] as const;
  const batches: Array<[string, Omit<QueueBatchRequest, 'actorUserAccountId'>]> = [
    ['open', { view: 'open', counts: [...toReview] }],
    ['open flagged', { view: 'open', show: 'flagged', counts: [...toReview] }],
    ['open mine', { view: 'open', show: 'mine', counts: [...toReview] }],
    ['finished this month', { view: 'lines_decided', show: 'month', sort: 'finished', counts: ['month', 'sign_off', 'decided', 'completed', 'all'] }],
  ];
  for (const [name, request] of batches) {
    it(`queue batch: ${name}`, async () => {
      const { result } = await measure('review', `listReviewQueueBatch ${name}`, () =>
        listReviewQueueBatch(db, { ...request, actorUserAccountId: fixtures.staffUserAccountId }, { limit: BATCH_SIZE, after: null }),
      );
      expect(result.summary).toBeDefined();
    });
  }

  it('queue batch: searched by case number', async () => {
    const q = caseReference(caseOfInvoice(volume, inReview));
    const { result } = await measure('review', 'listReviewQueueBatch search', () =>
      listReviewQueueBatch(db, { view: 'all', q, sort: 'search', actorUserAccountId: fixtures.staffUserAccountId }, { limit: BATCH_SIZE, after: null }),
    );
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('cases, first batch', async () => {
    const { result } = await measure('review', 'listCaseBatch', () => listCaseBatch(db, {}, { limit: BATCH_SIZE, after: null }));
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('people, first batch', async () => {
    const { result } = await measure('review', 'listPeopleBatch', () => listPeopleBatch(db, {}, { limit: BATCH_SIZE, after: null }));
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('queue, as the route loads it', async () => {
    await measure('review', 'GET /api/invoices', async () => json(await staffCall('GET', '/api/invoices')));
  });

  it('invoice intake', async () => {
    await measure('review', 'listInvoiceIntake', () => listInvoiceIntake(db, fixtures.staffUserAccountId));
  });

  it('pre-authorization usage by county', async () => {
    const { result } = await measure('review', 'preauthorizationUsageByCounty', () =>
      preauthorizationUsageByCounty(db, fixtures.staffUserAccountId, { from: '2025-01-01', to: '2026-12-31' }),
    );
    expect(result.counties.length).toBeGreaterThan(0);
  });
});

describe('import and upload', () => {
  it('duplicate file and invoice number warnings', async () => {
    const check = (g: number) =>
      db.transaction((tx) =>
        duplicateWarnings(tx, perfId('import', g), perfId('document', g), '', perfId('pro', professionalOfInvoice(g)), `INV-${g - volume.cases}`),
      );
    const { result } = await measure('import', 'duplicateWarnings by number', () => check(repeatedNumber));
    expect(result.map((warning) => warning.code)).toContain('duplicate_invoice_number');
  });

  it('duplicate warnings rechecked for a new sender', async () => {
    let warnings: unknown;
    await measure('import', 'recheckDuplicates', async () => {
      await db
        .transaction(async (tx) => {
          await recheckDuplicates(tx, perfId('invoice', repeatedFile), perfId('pro', professionalOfInvoice(repeatedFile)));
          const [row] = await tx
            .select({ result: invoiceImport.extractionResult })
            .from(invoiceImport)
            .where(eq(invoiceImport.invoiceImportId, perfId('import', repeatedFile)));
          warnings = (row?.result as { warnings?: unknown } | undefined)?.warnings;
          // Leaves the generated data as it was.
          tx.rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof TransactionRollbackError)) throw error;
        });
    });
    expect((warnings as Array<{ code: string }>).map((warning) => warning.code)).toContain('duplicate_file');
  });

  it('cases an upload may go to, and the one it names', async () => {
    const { result } = await measure('upload', 'uploadCases + suggestUploadCase', async () => {
      const cases = await uploadCases(db, submitter);
      return { cases, suggestion: suggestUploadCase(cases, { lines: [], invoiceText: `Re: ${caseReference(caseOfInvoice(volume, draft))}` }, undefined) };
    });
    expect(result.cases.length).toBeGreaterThan(0);
  });

  it('cases a file may be split across', async () => {
    const { result } = await measure('upload', 'splitCases', () => splitCases(db, submitter, submitter.professionalId!));
    expect(result.length).toBeGreaterThan(0);
  });

  it("submitter's invoice list", async () => {
    const { result } = await measure('upload', 'listPortalInvoices', () => listPortalInvoices(db, submitter));
    expect(result.length).toBeGreaterThan(0);
  });

  it('check page of a draft, as the route loads it', async () => {
    const { result } = await measure('upload', 'GET /api/portal/invoices/:id (draft)', async () =>
      json(await submitterCall('GET', `/api/portal/invoices/${perfId('invoice', draft)}`)),
    );
    expect(result.billingOverlaps).toBeInstanceOf(Array);
  });

  it('possible double billing on a draft, as its submitter', async () => {
    await measure('upload', 'findBillingOverlaps (submitter)', () => findBillingOverlaps(db, perfId('invoice', draft), submitter));
  });

  // A different month each run, so no send overlaps an earlier one.
  it('sending an invoice, with every check it runs', async () => {
    const caseId = perfId('case', caseOfInvoice(volume, draft));
    const send = (runNumber: number) => {
      const month = new Date(Date.UTC(2025, 5 + (runNumber % 18), 1));
      const day = (d: number) => new Date(month.getTime() + (d - 1) * 86_400_000).toISOString().slice(0, 10);
      const periodEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const lines = Array.from({ length: volume.linesPerInvoice }, (_, k) => ({
        lineType: 'time' as const,
        serviceDate: day(1 + (k % 28)),
        quantity: 1.5,
        description: `Synthetic sent item ${k}`,
      }));
      return createInvoice(db, submitter, { attested: true, caseId, periodStart: day(1), periodEnd, lines, submit: true });
    };
    const { result } = await measure('upload', 'createInvoice + submit', send);
    expect(result.invoiceId).toBeTruthy();
  });
});

describe('duplicate detection', () => {
  it('possible duplicate people', async () => {
    const { result } = await measure('duplicates', 'listPossibleDuplicates', () => listPossibleDuplicates(db));
    const reasons = new Set(result.flatMap((group) => group.pairs.flatMap((pair) => pair.reasons)));
    expect([...reasons]).toEqual(expect.arrayContaining(['same_name', 'same_email', 'same_birth_date_and_family_name']));
  });

  it('possible duplicate cases', async () => {
    const { result } = await measure('duplicates', 'listPossibleDuplicateCases', () => listPossibleDuplicateCases(db));
    expect(result.length).toBeGreaterThan(0);
  });

  it('possible duplicate people, as the route loads them', async () => {
    await measure('duplicates', 'GET /api/people/possible-duplicates', async () => json(await staffCall('GET', '/api/people/possible-duplicates')));
  });

  it('email already in use', async () => {
    const { result } = await measure('duplicates', 'emailInUse', () => emailInUse(db, 'perf-client-1@example.test', 'any'));
    expect(result).toBe(true);
  });

  it('person search', async () => {
    const { result } = await measure('duplicates', 'GET /api/people?q=', async () => json(await staffCall('GET', '/api/people?q=Alder')));
    expect((result.items as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('baseline', () => {
  it('no check is slower, or makes more queries, than perf/results/baseline.json', () => {
    const { failures, notes } = regressions(scale);
    if (notes.length > 0) process.stdout.write(`\n${notes.join('\n')}\n`);
    expect(failures).toEqual([]);
  });

  // Fewer is an improvement: save the new counts with PERF_SAVE_QUERY_COUNTS=1.
  it('no check makes more queries than perf/queryCounts.json', () => {
    const { failures, notes } = queryCountChanges(scale);
    if (notes.length > 0) process.stdout.write(`\nFewer queries than perf/queryCounts.json; save them with PERF_SAVE_QUERY_COUNTS=1:\n${notes.join('\n')}\n`);
    expect(failures).toEqual([]);
  });
});
