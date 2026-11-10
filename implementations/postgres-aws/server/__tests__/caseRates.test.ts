import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { addOwnRates } from '../src/billing/professionalRates';
import { priceLines } from '../src/billing/priceLines';
import { applyLineRate, CASE_RATE_CHANGED_MESSAGE } from '../src/billing/caseRates';
import { reviewInvoiceLine } from '../src/billing/reviewInvoiceLine';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getReferenceId } from '../src/db/referenceLookups';
import { ValidationError } from '../src/errors';
import {
  caseRate,
  invoice,
  invoiceApprovalChain,
  invoiceDecisionReasons,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  preauthorization,
  preauthorizationDecision,
  preauthorizationOutcomes,
  preauthorizationStatuses,
  professional,
  userAccount,
} from '../src/db/schema';

let fixtures: BaselineFixtureIds;
let reviewer: string;
let admin: string;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
  reviewer = await createStaff('reviewer', 'Reviewer One');
  admin = await createStaff('admin', 'Admin One');
});

afterAll(async () => {
  await testPool.end();
});

async function newCase(): Promise<string> {
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
  return caseId;
}

async function newProfessional(hourlyRate: number, kindId?: string) {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  if (kindId) {
    await testDb.update(professional).set({ professionalKindId: kindId }).where(eq(professional.professionalId, professionalId));
  } else {
    kindId = await giveRate(testDb, admin, professionalId, hourlyRate);
  }
  return { userAccountId: account!.userAccountId, professionalId, kindId };
}

// A sent invoice of time lines on these dates and hours, priced as on submission.
async function sentInvoice(caseId: string, person: { userAccountId: string; professionalId: string }, lines: Array<[string, string]>) {
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: person.userAccountId,
      professionalId: person.professionalId,
      statusId: await getReferenceId(testDb, invoiceStatuses, 'submitted'),
      submittedAt: new Date(),
      submittedTotal: '0.00',
      caseId,
    })
    .returning();
  const invoiceId = row!.invoiceId;
  await testDb.insert(invoiceApprovalChain).values({ invoiceId, createdByUserAccountId: person.userAccountId, createdAt: new Date() });
  const timeTypeId = await getReferenceId(testDb, invoiceLineTypes, 'time');
  const inserted = await testDb
    .insert(invoiceLine)
    .values(lines.map(([serviceDate, quantity], position) => ({ invoiceId, caseId, lineTypeId: timeTypeId, amount: '0', serviceDate, quantity, position })))
    .returning();
  await testDb.transaction((tx) => priceLines(tx, invoiceId, { billedProfessionalId: person.professionalId, unmatchedMeansBilled: true, strict: true }));
  return { invoiceId, lineIds: inserted.sort((a, b) => a.position - b.position).map((line) => line.invoiceLineId) };
}

async function lineRates(invoiceId: string) {
  const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
  return detail.lines.map((line) => ({ configuredRate: Number(line.configuredRate), rateSource: line.rateSource, working: line.working }));
}

async function reasonId(code: string) {
  const [row] = await testDb.select({ id: invoiceDecisionReasons.id }).from(invoiceDecisionReasons).where(eq(invoiceDecisionReasons.code, code));
  return row!.id;
}

describe('default rates', () => {
  it('prefer the case rate for the person, then for their kind, then the configured rates', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const other = await newCase();
    const { invoiceId: anchor } = await sentInvoice(other, person, [['2026-01-02', '1']]);
    const reason = await reasonId('case_rate_agreed');
    const row = (values: Partial<typeof caseRate.$inferInsert>) => ({
      caseId,
      rateType: 'hourly',
      effectiveFrom: '2026-02-01',
      reasonId: reason,
      invoiceId: anchor,
      recordedByUserAccountId: reviewer,
      recordedAt: new Date(),
      ...values,
    });
    await testDb.insert(caseRate).values(row({ professionalKindId: person.kindId, rate: '110.00' }));
    await testDb.insert(caseRate).values(row({ professionalId: person.professionalId, rate: '120.00', effectiveFrom: '2026-03-01' }));
    await addOwnRates(testDb, admin, person.professionalId, { hourlyRate: 105, effectiveFrom: '2026-01-10' });

    const { invoiceId } = await sentInvoice(caseId, person, [
      ['2026-01-05', '1'],
      ['2026-01-20', '1'],
      ['2026-02-15', '1'],
      ['2026-03-15', '1'],
    ]);

    expect((await lineRates(invoiceId)).map(({ configuredRate, rateSource }) => [configuredRate, rateSource])).toEqual([
      [100, 'kind'],
      [105, 'person'],
      [110, 'case_kind'],
      [120, 'case_person'],
    ]);
  });

  it('returns to the configured rate from a row with no rate', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const { invoiceId: first, lineIds } = await sentInvoice(caseId, person, [['2026-02-02', '2']]);
    const set = await applyLineRate(testDb, reviewer, first, lineIds[0]!, {
      rate: 130,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_agreed',
      basedOnCaseRateId: null,
    });
    const { invoiceId: second, lineIds: secondLines } = await sentInvoice(caseId, person, [['2026-03-10', '1']]);

    await applyLineRate(testDb, reviewer, second, secondLines[0]!, {
      rate: null,
      scope: 'case',
      target: 'person',
      effectiveFrom: '2026-03-01',
      reasonCode: 'case_rate_correction',
      basedOnCaseRateId: set.caseRateId,
    });

    expect((await lineRates(second))[0]).toMatchObject({ configuredRate: 100, rateSource: 'kind', working: { approvedRate: '100.000' } });
    const { invoiceId } = await sentInvoice(caseId, person, [['2026-02-10', '1'], ['2026-03-10', '1']]);
    expect((await lineRates(invoiceId)).map((line) => line.configuredRate)).toEqual([130, 100]);
  });

  it('checks billed rates against a case rate before a pre-authorized one', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const [preauth] = await testDb
      .insert(preauthorization)
      .values({
        caseId,
        professionalId: person.professionalId,
        statusId: await getReferenceId(testDb, preauthorizationStatuses, 'approved'),
        requestedAt: new Date(),
      })
      .returning();
    await testDb.insert(preauthorizationDecision).values({
      preauthorizationId: preauth!.preauthorizationId,
      sequenceNumber: 1,
      outcomeId: await getReferenceId(testDb, preauthorizationOutcomes, 'approved'),
      approvedAmount: '2000.00',
      approvedHourlyRate: '110.00',
      effectiveAt: new Date(),
      decidedAt: new Date(),
      decidedByUserAccountId: fixtures.staffUserAccountId,
    });
    const { invoiceId: first, lineIds } = await sentInvoice(caseId, person, [['2026-02-02', '2']]);
    expect((await loadInvoiceDetail(testDb, first, 'staff'))!.lines[0]).toMatchObject({ rateLimit: '110.00', rateLimitSource: 'preauthorized' });
    await applyLineRate(testDb, reviewer, first, lineIds[0]!, { rate: 130, scope: 'case', target: 'person', reasonCode: 'case_rate_agreed', basedOnCaseRateId: null });

    const { invoiceId } = await sentInvoice(caseId, person, [['2026-02-10', '1']]);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.lines[0]).toMatchObject({ rateLimit: '130.000', rateLimitSource: 'case' });
  });
});

describe('a rate applied beyond one line', () => {
  it('decides the undecided matching lines on this invoice at that rate', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const { invoiceId, lineIds } = await sentInvoice(caseId, person, [
      ['2026-02-02', '2'],
      ['2026-02-03', '1'],
      ['2026-02-04', '3'],
    ]);
    await reviewInvoiceLine(testDb, reviewer, invoiceId, lineIds[2]!, { outcome: 'approved' });

    const result = await applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, { rate: 90, scope: 'matching', note: 'Agreed by phone.' });

    expect(result).toMatchObject({ decided: 2, caseRateId: null });
    const lines = await lineRates(invoiceId);
    expect(lines.map((line) => [line.working?.approvedRate, line.working?.approvedAmount])).toEqual([
      ['90.000', '180.00'],
      ['90.000', '90.00'],
      [null, '300.00'],
    ]);
    expect(lines[1]!.working?.note).toBe('Agreed by phone.');
    expect(await testDb.select().from(caseRate)).toHaveLength(0);
  });

  it('sets the case default from a date, with a reason, and decides the lines it governs', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const { invoiceId, lineIds } = await sentInvoice(caseId, person, [
      ['2026-02-02', '2'],
      ['2026-02-10', '1'],
    ]);

    await expect(
      applyLineRate(testDb, reviewer, invoiceId, lineIds[1]!, { rate: 125, scope: 'case', target: 'person', reasonCode: 'excessive_time', basedOnCaseRateId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, {
        rate: 125,
        scope: 'case',
        target: 'person',
        effectiveFrom: '2026-02-05',
        reasonCode: 'case_rate_agreed',
        basedOnCaseRateId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const result = await applyLineRate(testDb, reviewer, invoiceId, lineIds[1]!, {
      rate: 125,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_agreed',
      basedOnCaseRateId: null,
    });

    const [row] = await testDb.select().from(caseRate);
    expect(row).toMatchObject({
      caseRateId: result.caseRateId,
      professionalId: person.professionalId,
      professionalKindId: null,
      rateType: 'hourly',
      rate: '125.000',
      replacedRate: '100.000',
      effectiveFrom: '2026-02-02',
      invoiceId,
      recordedByUserAccountId: reviewer,
    });
    const lines = await lineRates(invoiceId);
    expect(lines.map((line) => [line.configuredRate, line.rateSource, line.working?.approvedRate])).toEqual([
      [125, 'case_person', '125.000'],
      [125, 'case_person', '125.000'],
    ]);
    expect(lines[0]!.working?.reasonCode).toBe('case_rate_agreed');
    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.caseRates).toMatchObject([{ rate: '125.000', replacedRate: '100.000', recordedByDisplayName: 'Reviewer One', inForce: true }]);
  });

  it('refuses a second change based on a case rate that has since changed', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const { invoiceId, lineIds } = await sentInvoice(caseId, person, [['2026-02-02', '2']]);
    const first = await applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, {
      rate: 125,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_agreed',
      basedOnCaseRateId: null,
    });

    await expect(
      applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, { rate: 130, scope: 'case', target: 'person', reasonCode: 'case_rate_agreed', basedOnCaseRateId: null }),
    ).rejects.toThrow(CASE_RATE_CHANGED_MESSAGE);

    const second = await applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, {
      rate: 130,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_correction',
      basedOnCaseRateId: first.caseRateId,
    });
    const [row] = await testDb.select().from(caseRate).where(eq(caseRate.caseRateId, second.caseRateId!));
    expect(row!.correctsCaseRateId).toBe(first.caseRateId);
  });

  it('sets a default for a kind without repricing invoices already sent, which are flagged instead', async () => {
    const caseId = await newCase();
    const first = await newProfessional(100);
    const colleague = await newProfessional(0, first.kindId);
    const { invoiceId: earlier } = await sentInvoice(caseId, colleague, [['2026-02-03', '1']]);
    const { invoiceId, lineIds } = await sentInvoice(caseId, first, [['2026-02-02', '2']]);

    await applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, {
      rate: 115,
      scope: 'case',
      target: 'kind',
      reasonCode: 'other',
      note: 'New rate for this case.',
      basedOnCaseRateId: null,
    });

    expect((await lineRates(invoiceId))[0]).toMatchObject({ configuredRate: 115, rateSource: 'case_kind' });
    const stale = (await loadInvoiceDetail(testDb, earlier, 'staff'))!;
    expect(stale.lines[0]).toMatchObject({ configuredRate: '100.000', rateSource: 'kind' });
    expect(stale.caseRatesChangedSinceSent).toHaveLength(1);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.caseRatesChangedSinceSent).toEqual([]);
    const { invoiceId: later } = await sentInvoice(caseId, colleague, [['2026-02-04', '1']]);
    expect((await lineRates(later))[0]).toMatchObject({ configuredRate: 115, rateSource: 'case_kind' });
  });

  it('refuses a case default on an invoice with no case', async () => {
    const caseId = await newCase();
    const person = await newProfessional(100);
    const { invoiceId, lineIds } = await sentInvoice(caseId, person, [['2026-02-02', '2']]);
    await testDb.update(invoice).set({ caseId: null }).where(eq(invoice.invoiceId, invoiceId));

    await expect(
      applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, { rate: 125, scope: 'case', target: 'person', reasonCode: 'case_rate_agreed' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(applyLineRate(testDb, reviewer, invoiceId, lineIds[0]!, { rate: 125, scope: 'matching' })).resolves.toMatchObject({ decided: 1 });
  });
});
