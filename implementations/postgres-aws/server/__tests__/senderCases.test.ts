// Design I's sender pages: a draft filed by person put under one of the
// sender's cases, and their case list.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { userAccount } from '../src/db/schema';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createCase } from '../src/intake/createCase';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { listPortalCases } from '../src/portal/listPortalCases';
import { assignExternalSubmitterToCase } from '../src/cases/assignExternalSubmitterToCase';
import { setDraftCase } from '../src/billing/invoiceLifecycle/drafts';
import { submitInvoice } from '../src/billing/invoiceLifecycle/submit';
import { setPreauthorizedAmount } from '../src/billing/preauthorizations';
import { applyLineRate } from '../src/billing/caseRates';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { NotAssignedToCaseError } from '../src/portal/caseAssignmentAuthorization';

let fixtures: BaselineFixtureIds;
let reviewer: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  reviewer = await createStaff('reviewer', 'Reviewer One');
});

afterAll(async () => {
  await testPool.end();
});

async function newCase(caseNumber: string): Promise<string> {
  const { caseId } = await createCase(
    testDb,
    { userAccountId: fixtures.staffUserAccountId },
    {
      requestId: randomUUID(),
      newClient: { displayName: `Client ${caseNumber}`, confirmedNew: true },
      caseNumber,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-15T12:00:00Z'),
    },
  );
  return caseId;
}

async function newSender(email: string) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), professionalId, userAccountId: account!.userAccountId };
}

async function draft(actor: Awaited<ReturnType<typeof newSender>>['actor'], caseNumber: string) {
  const { invoiceId } = await createInvoice(testDb, actor, {
    caseId: null,
    caseNumber,
    submit: false,
    lines: [{ lineType: 'time', serviceDate: '2026-03-02', quantity: 2, description: 'Review' }],
  });
  return invoiceId;
}

describe('a draft filed by person', () => {
  it('goes under one of its sender’s cases, priced at the case’s rate, and straight to review when sent', async () => {
    const sender = await newSender('sender@example.com');
    const caseId = await newCase('26-CR-00211');
    await assignExternalSubmitterToCase(testDb, fixtures.staffUserAccountId, caseId, { professionalId: sender.professionalId });
    const onCase = await draft(sender.actor, '26-CR-00211');
    await setDraftCase(testDb, sender.actor, onCase, { caseId });
    await submitInvoice(testDb, sender.actor, onCase, { attested: true, filedByPerson: true });
    const sentLine = (await loadInvoiceDetail(testDb, onCase, 'staff'))!.lines[0]!;
    await applyLineRate(testDb, reviewer, onCase, sentLine.invoiceLineId, {
      rate: 120,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_agreed',
      basedOnCaseRateId: null,
    });

    const invoiceId = await draft(sender.actor, '26cr211');
    const result = await setDraftCase(testDb, sender.actor, invoiceId, { caseId });

    expect(result).toMatchObject({ caseId, caseNumber: '26-CR-00211' });
    let detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ caseId, caseNumberAsTyped: '26-CR-00211', submittedTotal: '240.00' });
    expect(detail.lines[0]).toMatchObject({ rateSource: 'case_person' });

    await submitInvoice(testDb, sender.actor, invoiceId, { attested: true, filedByPerson: true });
    detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ caseId, statusCode: 'submitted' });
  });

  it('can be taken off the case again, keeping its number', async () => {
    const sender = await newSender('sender@example.com');
    const caseId = await newCase('26-CR-00211');
    await assignExternalSubmitterToCase(testDb, fixtures.staffUserAccountId, caseId, { professionalId: sender.professionalId });
    const invoiceId = await draft(sender.actor, '26-CR-00211');
    await setDraftCase(testDb, sender.actor, invoiceId, { caseId });

    await setDraftCase(testDb, sender.actor, invoiceId, { caseId: null });

    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice).toMatchObject({ caseId: null, caseNumberAsTyped: '26-CR-00211' });
  });

  it('is refused a case its sender isn’t on', async () => {
    const sender = await newSender('sender@example.com');
    const caseId = await newCase('26-CR-00211');
    const invoiceId = await draft(sender.actor, '26-CR-00211');

    await expect(setDraftCase(testDb, sender.actor, invoiceId, { caseId })).rejects.toBeInstanceOf(NotAssignedToCaseError);
  });
});

describe('a sender’s cases', () => {
  it('show their own pre-authorized amount, never the whole case’s', async () => {
    const sender = await newSender('sender@example.com');
    const caseId = await newCase('26-CR-00211');
    await assignExternalSubmitterToCase(testDb, fixtures.staffUserAccountId, caseId, { professionalId: sender.professionalId });
    await setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: sender.professionalId, amount: 500 });
    await setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: null, amount: 5000 });

    const { cases } = await listPortalCases(testDb, sender.userAccountId);

    expect(cases).toHaveLength(1);
    expect(cases[0]!.preauthorizations).toMatchObject([{ professionalId: sender.professionalId, ceiling: '500.00' }]);
  });
});
