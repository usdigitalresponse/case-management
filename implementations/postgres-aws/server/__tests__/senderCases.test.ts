// A sender's draft and its case: only one started from their case is under it;
// otherwise the billing office adds the number or case in review (design K).
// And their case list.
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
import { setDraftCaseNumber } from '../src/billing/invoiceLifecycle/drafts';
import { setDraftCaseChoice } from '../src/billing/caseChoice';
import { ForbiddenError } from '../src/errors';
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

// The number stands in for one read from the sender's file.
async function draft(actor: Awaited<ReturnType<typeof newSender>>['actor'], caseNumber: string) {
  const { invoiceId } = await createInvoice(testDb, actor, {
    caseId: null,
    caseNumber,
    submit: false,
    lines: [{ lineType: 'time', serviceDate: '2026-03-02', quantity: 2, description: 'Review' }],
  });
  return invoiceId;
}

// Started from one of the sender's cases.
async function draftOnCase(actor: Awaited<ReturnType<typeof newSender>>['actor'], caseId: string) {
  const { invoiceId } = await createInvoice(testDb, actor, {
    caseId,
    submit: false,
    lines: [{ lineType: 'time', serviceDate: '2026-03-02', quantity: 2, description: 'Review' }],
  });
  return invoiceId;
}

describe('a sender’s draft and its case', () => {
  it('started from one of its sender’s cases, is priced at the case’s rate and goes straight to review when sent', async () => {
    const sender = await newSender('sender@example.com');
    const caseId = await newCase('26-CR-00211');
    await assignExternalSubmitterToCase(testDb, fixtures.staffUserAccountId, caseId, { professionalId: sender.professionalId });
    const onCase = await draftOnCase(sender.actor, caseId);
    await submitInvoice(testDb, sender.actor, onCase, { attested: true, filedByPerson: true });
    const sentLine = (await loadInvoiceDetail(testDb, onCase, 'staff'))!.lines[0]!;
    await applyLineRate(testDb, reviewer, onCase, sentLine.invoiceLineId, {
      rate: 120,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_agreed',
      basedOnCaseRateId: null,
    });

    const invoiceId = await draftOnCase(sender.actor, caseId);
    let detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.caseNumber).toBe('26-CR-00211');
    expect(detail.invoice).toMatchObject({ caseId, submittedTotal: '240.00' });
    expect(detail.lines[0]).toMatchObject({ rateSource: 'case_person' });

    await submitInvoice(testDb, sender.actor, invoiceId, { attested: true, filedByPerson: true });
    detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ caseId, statusCode: 'submitted' });
  });

  it('takes the sender’s case number, but never a case or answer: the billing office adds them in review', async () => {
    const sender = await newSender('sender@example.com');
    const invoiceId = await draft(sender.actor, '26-CR-00211');

    await setDraftCaseNumber(testDb, sender.actor, invoiceId, { caseNumber: '26-CR-00999' });
    await expect(setDraftCaseChoice(testDb, sender.actor, invoiceId, { choice: 'none' })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.invoice).toMatchObject({ caseNumberAsTyped: '26-CR-00999', caseChoice: null });
  });

  it('is refused a case its sender isn’t on', async () => {
    const sender = await newSender('sender@example.com');
    const caseId = await newCase('26-CR-00211');

    await expect(draftOnCase(sender.actor, caseId)).rejects.toBeInstanceOf(NotAssignedToCaseError);
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
