// Invoices filed by person, with a case number as typed (../src/billing/caseNumbers.ts).
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { setDraftCaseNumber } from '../src/billing/invoiceLifecycle/drafts';
import { submitInvoice } from '../src/billing/invoiceLifecycle/submit';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { closeKey, labelledCaseNumber, matchCaseNumbers, readCaseNumber, searchMatch } from '../src/billing/caseNumbers';
import { ValidationError } from '../src/errors';
import { invoiceApprovalChain, invoiceAttestation, userAccount } from '../src/db/schema';
import { giveRate } from './rateHelpers';

describe('case numbers as typed', () => {
  it('compares closely, ignoring case, spaces, dashes and leading zeros', () => {
    expect(closeKey('26-CR-00418')).toBe(closeKey('26cr 0418'));
    expect(closeKey('26-CR-00418')).not.toBe(closeKey('26-CR-00419'));
    const matches = matchCaseNumbers([
      { invoiceId: 'a', caseNumber: '26-CR-00418' },
      { invoiceId: 'b', caseNumber: '26-CR-00418' },
      { invoiceId: 'c', caseNumber: '26-CR-0418' },
      { invoiceId: 'd', caseNumber: null },
    ]);
    expect(matches.get('a')).toEqual({ same: 1, close: 1 });
    expect(matches.get('c')).toEqual({ same: 0, close: 2 });
    expect(matches.has('d')).toBe(false);
  });

  it('searches names and numbers exactly, then numbers closely', () => {
    expect(searchMatch('ada', ['Ada Lovelace', null], '26-CR-00418')).toBe('exact');
    expect(searchMatch('cr-004', ['Ada Lovelace', null], '26-CR-00418')).toBe('exact');
    expect(searchMatch('26cr418', ['Ada Lovelace', null], '26-CR-00418')).toBe('close');
    expect(searchMatch('26cr419', ['Ada Lovelace', null], '26-CR-00418')).toBeNull();
    expect(searchMatch(' ', ['Ada Lovelace', null], '26-CR-00418')).toBeNull();
  });

  it('reads the labels forms use, preferring the court’s number', () => {
    expect(labelledCaseNumber('Sample system Case ID: DEMO-26-00101\nCourt Case No(s).: COURT-00101')).toBe('COURT-00101');
    expect(labelledCaseNumber('Case Number(s): 26-CR-00214')).toBe('26-CR-00214');
    expect(labelledCaseNumber('Docket #26CR230')).toBe('26CR230');
    expect(labelledCaseNumber('billing 2.5 hours per case.\n2026-03-01 Review')).toBeNull();
  });

  it('reads a labelled number from the file, never a name', () => {
    expect(readCaseNumber({ invoiceText: 'Re: State v. Example, Case No. 26-CR-00418\nServices', lines: [] })).toEqual({ value: '26-CR-00418' });
    expect(readCaseNumber({ invoiceText: 'Case review and preparation', lines: [] })).toBeNull();
    expect(readCaseNumber({ invoiceText: '', lines: [{ caseLabel: 'Example Client' }] as never })).toBeNull();
  });
});

describe('sending an invoice filed by person', () => {
  let fixtures: BaselineFixtureIds;

  beforeEach(async () => {
    fixtures = await resetAndSeedBaselineFixtures(testDb);
  });

  afterAll(async () => {
    await testPool.end();
  });

  async function draftFrom(email: string) {
    const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
    const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
    await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    const { invoiceId } = await createInvoice(testDb, staff, {
      caseId: null,
      professionalId,
      submit: false,
      lines: [{ lineType: 'expense', amount: 120, serviceDate: '2026-02-02' }],
    });
    return { staff, invoiceId };
  }

  const send = { filedByPerson: true, receivedVia: 'email', receivedOn: '2026-02-03' };

  it('lets an attorney send their own straight to review, attesting to the case number', async () => {
    const email = 'attorney@example.com';
    const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
    const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
    await giveRate(testDb, fixtures.staffUserAccountId, professionalId, 100);
    const attorney = await resolvePortalActor(testDb, account!.userAccountId);
    const { invoiceId } = await createInvoice(testDb, attorney, {
      caseId: null,
      submit: false,
      lines: [{ lineType: 'expense', amount: 80, serviceDate: '2026-02-02' }],
    });
    await expect(submitInvoice(testDb, attorney, invoiceId, { filedByPerson: true, attested: true })).rejects.toThrow(ValidationError);

    await setDraftCaseNumber(testDb, attorney, invoiceId, { caseNumber: '26-CR-00418' });
    expect(await submitInvoice(testDb, attorney, invoiceId, { filedByPerson: true, attested: true })).toEqual({ invoiceId, status: 'submitted' });
    const [attestation] = await testDb
      .select({ statement: invoiceAttestation.statement })
      .from(invoiceAttestation)
      .innerJoin(invoiceApprovalChain, eq(invoiceAttestation.invoiceApprovalChainId, invoiceApprovalChain.invoiceApprovalChainId))
      .where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    expect(attestation?.statement).toBe('I confirm this invoice is true and correct, and the work was done for case 26-CR-00418.');
  });

  it('needs the case number, then goes straight to review with it', async () => {
    const { staff, invoiceId } = await draftFrom('sender@example.com');
    await expect(submitInvoice(testDb, staff, invoiceId, send)).rejects.toThrow(ValidationError);

    expect(await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber: '  26-CR-00418 ' })).toEqual({
      invoiceId,
      caseNumber: '26-CR-00418',
    });
    expect(await submitInvoice(testDb, staff, invoiceId, send)).toEqual({ invoiceId, status: 'submitted' });

    const { invoices } = await listReviewQueue(testDb, 'open');
    const queued = invoices.find((row) => row.invoiceId === invoiceId)!;
    expect(queued.caseNumberAsTyped).toBe('26-CR-00418');
    expect(queued.flags.map((flag) => flag.kind)).not.toContain('no_case');
  });

  it('counts other sent invoices with the same or a close case number', async () => {
    const numbers = ['26-CR-00418', '26-CR-00418', '26-cr-0418'];
    const ids: string[] = [];
    for (const [index, caseNumber] of numbers.entries()) {
      const { staff, invoiceId } = await draftFrom(`sender${index}@example.com`);
      await setDraftCaseNumber(testDb, staff, invoiceId, { caseNumber });
      await submitInvoice(testDb, staff, invoiceId, send);
      ids.push(invoiceId);
    }
    const { invoices } = await listReviewQueue(testDb, 'open');
    const matchesOf = (invoiceId: string) => invoices.find((row) => row.invoiceId === invoiceId)!.caseNumberMatches;
    expect(matchesOf(ids[0]!)).toEqual({ same: 1, close: 1 });
    expect(matchesOf(ids[2]!)).toEqual({ same: 0, close: 2 });
  });
});
