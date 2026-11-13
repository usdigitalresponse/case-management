// Invoice overview (design K47): invoices counted and named by step of review.
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { invoice, invoiceStatuses, userAccount } from '../src/db/schema';
import { getReferenceId } from '../src/db/referenceLookups';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { reassignReviewer } from '../src/billing/reviewAssignment';
import { COMMUNICATION_COMPLETED_EVENT_CODE, recordInvoiceEvent } from '../src/billing/invoiceEvents';
import { invoiceOverview, loadRecentInvoiceChanges } from '../src/billing/invoiceOverview';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function sent(caseNumber: string) {
  const email = `sender-${caseNumber}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: `Sender ${caseNumber}`, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  const actor = await resolvePortalActor(testDb, account!.userAccountId);
  const { invoiceId } = await createInvoice(testDb, actor, {
    caseId: null,
    caseNumber,
    attested: true,
    lines: [{ lineType: 'time', serviceDate: '2026-02-02', quantity: 1, description: 'Review' }],
  });
  return invoiceId;
}

async function setStatus(invoiceId: string, code: string) {
  await testDb.update(invoice).set({ statusId: await getReferenceId(testDb, invoiceStatuses, code) }).where(eq(invoice.invoiceId, invoiceId));
}

describe('the invoice overview', () => {
  it('counts and names invoices at each step, leaving out completed ones', async () => {
    const reviewer = await createStaff('reviewer', 'Reviewer One');
    const waiting = await sent('26-CR-0001');
    const reviewing = await sent('26-CR-0002');
    await reassignReviewer(testDb, fixtures.staffUserAccountId, reviewing, { userAccountId: reviewer });
    await setStatus(await sent('26-CR-0003'), 'awaiting_sign_off');
    const signedOff = await sent('26-CR-0004');
    await setStatus(signedOff, 'approved');
    const completed = await sent('26-CR-0005');
    await setStatus(completed, 'approved');
    await testDb.transaction(async (tx) =>
      recordInvoiceEvent(tx, { invoiceId: completed, eventTypeCode: COMMUNICATION_COMPLETED_EVENT_CODE, statusId: await getReferenceId(tx, invoiceStatuses, 'approved'), actorUserAccountId: fixtures.staffUserAccountId }),
    );

    const { steps } = await invoiceOverview(testDb);
    expect(steps.map(({ step, count }) => [step, count])).toEqual([
      ['no_reviewer', 1],
      ['being_reviewed', 1],
      ['sign_off', 1],
      ['not_completed', 1],
    ]);
    expect(steps[0]!.invoices).toEqual([{ invoiceId: waiting, senderDisplayName: 'sender-26-CR-0001@example.com', caseNumber: '26-CR-0001', submittedTotal: '100.00' }]);
    expect(steps[3]!.invoices[0]!.invoiceId).toBe(signedOff);

    const changes = await loadRecentInvoiceChanges(testDb);
    expect(changes.find((change) => change.invoiceId === waiting)).toMatchObject({ what: 'Sent, no reviewer yet', caseNumber: '26-CR-0001' });
  });
});
