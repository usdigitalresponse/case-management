// A reviewer's case time log (model/rules.yaml check_lines_against_time_log).
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { invoiceLine, invoiceLineWorkingDecision, reviewTimeLog, userAccount } from '../src/db/schema';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { recallInvoice } from '../src/billing/invoiceLifecycle';
import { repriceLines, reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { finishReview } from '../src/billing/reviewRounds';
import { reassignReviewer, setSignOffApprovers } from '../src/billing/reviewAssignment';
import { setReviewSettings } from '../src/billing/reviewSettings';
import { discardTimeLog, linkTimeLogEntries, loadTimeLogView, setTimeLogColumns, setTimeLogWorker, uploadTimeLog } from '../src/billing/reviewTimeLog';
import { ConflictError, ValidationError } from '../src/errors';

let fixtures: BaselineFixtureIds;
let reviewer: string;
let approver: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  reviewer = await createStaff('reviewer');
  approver = await createStaff('approver');
});

afterAll(async () => {
  await testPool.end();
});

const LOG = [
  'Date of Service,Time Spent,Caseworker,ID (with Link)',
  '"Mar 3, 2026",2,Avery Example,#1',
  '"Mar 10, 2026",3,Avery Example,#2',
  '"Mar 12, 2026",1,Avery E.,#3',
  '"Jan 5, 2026",4,Avery Example,#4',
].join('\r\n');

async function submitted() {
  const email = 'avery@example.com';
  const [account] = await testDb.insert(userAccount).values({ displayName: 'Avery Example', email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Avery Example');
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  const actor = await resolvePortalActor(testDb, account!.userAccountId);
  const { invoiceId } = await createInvoice(testDb, actor, {
    caseId: null,
    caseNumber: '26-CR-00106',
    attested: true,
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    lines: [
      { lineType: 'time', serviceDate: '2026-03-03', quantity: 2, description: 'Reviewed the report' },
      { lineType: 'time', serviceDate: '2026-03-10', quantity: 3.5, description: 'Drafted the report' },
      { lineType: 'time', serviceDate: '2026-03-12', quantity: 1, description: 'Call with counsel' },
    ],
  });
  const lineIds = (
    await testDb.select({ id: invoiceLine.invoiceLineId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId)).orderBy(asc(invoiceLine.serviceDate))
  ).map((row) => row.id);
  await reassignReviewer(testDb, reviewer, invoiceId, { userAccountId: reviewer });
  await setSignOffApprovers(testDb, reviewer, invoiceId, { userAccountIds: [approver] });
  return { invoiceId, lineIds, actor, professionalId };
}

const upload = (invoiceId: string, text = LOG, by = reviewer) => uploadTimeLog(testDb, by, invoiceId, { fileName: 'log.csv', bytes: Buffer.from(text) });

describe('checking lines against a time log', () => {
  it('compares the lines once uploaded', async () => {
    const { invoiceId } = await submitted();
    expect(await loadTimeLogView(testDb, invoiceId)).toBeNull();

    expect(await upload(invoiceId)).toEqual({ needsColumns: false });
    const view = (await loadTimeLogView(testDb, invoiceId))!;
    expect(view.fileName).toBe('log.csv');
    expect(view.blocksApproval).toBe(false);
    expect(view.lines.map((line) => line.status)).toEqual(['matched', 'hours_differ', 'other_account']);
    expect(view.entries.find((entry) => entry.entryId === '#4')!.use).toBe('outside_period');
  });

  it('asks for columns it cannot find, and keeps nothing until they are chosen', async () => {
    const { invoiceId } = await submitted();
    expect(await upload(invoiceId, 'when,amount\r\n2026-03-03,2\r\n')).toEqual({ needsColumns: true, headers: ['when', 'amount'] });
    expect(await loadTimeLogView(testDb, invoiceId)).toBeNull();
  });

  it("uses a confirmed name and the reviewer's links", async () => {
    const { invoiceId, lineIds, professionalId } = await submitted();
    await upload(invoiceId);
    await setTimeLogWorker(testDb, reviewer, invoiceId, { name: 'Avery E.', match: professionalId });
    const entries = (await loadTimeLogView(testDb, invoiceId))!.entries;
    await linkTimeLogEntries(testDb, reviewer, invoiceId, lineIds[1]!, { entryKeys: [entries.find((entry) => entry.entryId === '#2')!.key] });

    const view = (await loadTimeLogView(testDb, invoiceId))!;
    expect(view.lines.map((line) => [line.status, line.flagged])).toEqual([['matched', false], ['linked', true], ['matched', false]]);
    await expect(setTimeLogWorker(testDb, reviewer, invoiceId, { name: 'Nobody', match: null })).rejects.toThrow(ValidationError);
  });

  it('lets the reviewer choose other columns without uploading again, keeping links', async () => {
    const { invoiceId, lineIds } = await submitted();
    await upload(invoiceId, ['Date of Service,Time Spent,Billed Hours,Caseworker', '"Mar 3, 2026",2,1,Avery Example'].join('\r\n'));
    const before = (await loadTimeLogView(testDb, invoiceId))!;
    expect(before.headers).toEqual(['Date of Service', 'Time Spent', 'Billed Hours', 'Caseworker']);
    expect(before.columns).toMatchObject({ date: 0, hours: 1, worker: 3 });
    await linkTimeLogEntries(testDb, reviewer, invoiceId, lineIds[0]!, { entryKeys: [before.entries[0]!.key] });

    await setTimeLogColumns(testDb, reviewer, invoiceId, { columns: { date: 0, hours: 2, worker: 3 } });
    const after = (await loadTimeLogView(testDb, invoiceId))!;
    expect(after.entries[0]!.hours).toBe(1);
    expect(after.lines[0]).toMatchObject({ status: 'linked', flagged: true });
    await expect(setTimeLogColumns(testDb, reviewer, invoiceId, { columns: { date: 0 } })).rejects.toThrow(ValidationError);
  });

  it('is only for the reviewer while in review', async () => {
    const { invoiceId } = await submitted();
    const other = await createStaff('reviewer');
    await expect(upload(invoiceId, LOG, other)).rejects.toThrow(ConflictError);
  });

  it('asks why before approving the billed hours of a flagged line, when the setting says so', async () => {
    const { invoiceId, lineIds } = await submitted();
    await upload(invoiceId);

    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, { outcome: 'approved' });
    await setReviewSettings(testDb, fixtures.staffUserAccountId, { timeLogBlocksApproval: true });
    const line = lineIds[2]!;
    await expect(reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved' })).rejects.toThrow(ValidationError);
    await expect(reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved', approvedRate: 90 })).rejects.toThrow(ValidationError);
    // Cut by rate alone, the billed hours still stand.
    await expect(
      reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved_in_part', approvedQuantity: 1, approvedRate: 90, reasonCode: 'not_billable' }),
    ).rejects.toThrow(ValidationError);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, line, { outcome: 'approved', timeLogOverride: 'Logged under the office account.' });
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[0]!, { outcome: 'approved' });

    // Approved before blocking was on: finishing waits until it's decided again.
    await expect(finishReview(testDb, reviewer, invoiceId)).rejects.toThrow(ValidationError);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[1]!, { outcome: 'approved_in_part', approvedQuantity: 3, reasonCode: 'not_billable' });
    await finishReview(testDb, reviewer, invoiceId);
    expect(await testDb.select().from(reviewTimeLog)).toEqual([]);

    // Kept with the decision for sign-off; never shown to the submitter.
    const reason = async (audience: 'staff' | 'submitter') =>
      (await loadInvoiceDetail(testDb, invoiceId, audience))!.lines.find((row) => row.invoiceLineId === line)!.decision!.timeLogOverride;
    expect(await reason('staff')).toBe('Logged under the office account.');
    expect(await reason('submitter')).toBeNull();
  });

  it('leaves flagged lines out of repricing, since it keeps the billed hours', async () => {
    const { invoiceId, lineIds } = await submitted();
    await upload(invoiceId);
    await setReviewSettings(testDb, fixtures.staffUserAccountId, { timeLogBlocksApproval: true });
    await testDb.update(invoiceLine).set({ configuredRate: '80.000' }).where(eq(invoiceLine.invoiceId, invoiceId));

    expect(await repriceLines(testDb, reviewer, invoiceId)).toEqual({ invoiceId, repriced: 1 });
    const decided = await testDb.select({ id: invoiceLineWorkingDecision.invoiceLineId }).from(invoiceLineWorkingDecision);
    expect(decided.map((row) => row.id)).toEqual([lineIds[0]]);
  });

  it('is removed when the reviewer removes it or the invoice is recalled', async () => {
    const { invoiceId, actor } = await submitted();
    await upload(invoiceId);
    await discardTimeLog(testDb, reviewer, invoiceId);
    expect(await loadTimeLogView(testDb, invoiceId)).toBeNull();

    await upload(invoiceId);
    await recallInvoice(testDb, actor, invoiceId);
    expect(await testDb.select().from(reviewTimeLog)).toEqual([]);
  });
});
