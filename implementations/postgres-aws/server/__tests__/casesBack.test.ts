import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { priceLines } from '../src/billing/priceLines';
import { applyLineRate } from '../src/billing/caseRates';
import { matchInvoiceToCase, REOPENED_BY_MATCH } from '../src/billing/invoiceIntake';
import { closeCase } from '../src/cases/closeCase';
import { recordInvoiceEvent } from '../src/billing/invoiceEvents';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { loadPreauthorizationSummaries, setPreauthorizedAmount } from '../src/billing/preauthorizations';
import { findCasesByNumber } from '../src/cases/casesByNumber';
import { loadCaseListExtras, loadRecentCaseChanges } from '../src/cases/caseSummaries';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getReferenceId } from '../src/db/referenceLookups';
import { ForbiddenError, ValidationError } from '../src/errors';
import {
  caseAssignment,
  caseLifecycleEvent,
  caseTable,
  invoice,
  invoiceApprovalChain,
  invoiceEvent,
  invoiceEventTypes,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  preauthorizationDecision,
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

async function newProfessional(hourlyRate: number) {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, admin, professionalId, hourlyRate);
  return { userAccountId: account!.userAccountId, professionalId };
}

// A sent invoice filed by person, with the case number as typed and no case.
async function filedByPerson(person: { userAccountId: string; professionalId: string }, caseNumberAsTyped: string, caseId: string | null = null) {
  const [row] = await testDb
    .insert(invoice)
    .values({
      submittedByUserAccountId: person.userAccountId,
      professionalId: person.professionalId,
      statusId: await getReferenceId(testDb, invoiceStatuses, 'submitted'),
      submittedAt: new Date(),
      submittedTotal: '0.00',
      caseId,
      caseNumberAsTyped,
    })
    .returning();
  const invoiceId = row!.invoiceId;
  await testDb.insert(invoiceApprovalChain).values({ invoiceId, createdByUserAccountId: person.userAccountId, createdAt: new Date() });
  const [line] = await testDb
    .insert(invoiceLine)
    .values({ invoiceId, caseId, lineTypeId: await getReferenceId(testDb, invoiceLineTypes, 'time'), amount: '0', serviceDate: '2026-02-02', quantity: '2' })
    .returning();
  await testDb.transaction((tx) => priceLines(tx, invoiceId, { billedProfessionalId: person.professionalId, unmatchedMeansBilled: true, strict: true }));
  return { invoiceId, lineId: line!.invoiceLineId };
}

describe('cases by number', () => {
  it('finds a case by its number exactly, else closely', async () => {
    const exact = await newCase('26-CR-00211');
    const close = await newCase('26CR211');
    await newCase('26-CR-00999');

    const found = await findCasesByNumber(testDb, '26-cr-00211');

    expect(found.map((row) => [row.caseId, row.match])).toEqual([
      [exact, 'exact'],
      [close, 'close'],
    ]);
    expect(found[0]).toMatchObject({ clientDisplayName: 'Client 26-CR-00211', closed: false });
    expect(await findCasesByNumber(testDb, null)).toEqual([]);
  });
});

describe('matching an invoice filed by person while it is reviewed', () => {
  it('links it to the case, adds the provider, and keeps its prices', async () => {
    const caseId = await newCase('26-CR-00211');
    const person = await newProfessional(100);
    const { invoiceId } = await filedByPerson(person, '26-CR-00211');

    await expect(matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId })).rejects.toBeInstanceOf(ValidationError);
    await matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId, addMissing: true });

    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.invoice).toMatchObject({ caseId, caseNumberAsTyped: '26-CR-00211', statusCode: 'submitted', submittedTotal: '200.00' });
    expect(detail.lines[0]).toMatchObject({ amount: '200.00' });
    const [line] = await testDb.select({ caseId: invoiceLine.caseId }).from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
    expect(line?.caseId).toBe(caseId);
    const assigned = await testDb
      .select()
      .from(caseAssignment)
      .where(and(eq(caseAssignment.caseId, caseId), eq(caseAssignment.professionalId, person.professionalId), isNull(caseAssignment.endedAt)));
    expect(assigned).toHaveLength(1);
    const [event] = await testDb
      .select({ actor: invoiceEvent.actorUserAccountId })
      .from(invoiceEvent)
      .innerJoin(invoiceEventTypes, eq(invoiceEvent.eventTypeId, invoiceEventTypes.id))
      .where(and(eq(invoiceEvent.invoiceId, invoiceId), eq(invoiceEventTypes.code, 'matched_to_case')));
    expect(event?.actor).toBe(reviewer);
  });

  it('flags a case rate that would now give its lines another default', async () => {
    const caseId = await newCase('26-CR-00211');
    const person = await newProfessional(100);
    const onCase = await filedByPerson(person, '26-CR-00211', caseId);
    await applyLineRate(testDb, reviewer, onCase.invoiceId, onCase.lineId, {
      rate: 125,
      scope: 'case',
      target: 'person',
      reasonCode: 'case_rate_agreed',
      basedOnCaseRateId: null,
    });
    const { invoiceId } = await filedByPerson(person, '26-CR-00211');
    await matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId, addMissing: true });

    const detail = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(detail.lines[0]).toMatchObject({ configuredRate: '100.000', rateSource: 'kind' });
    expect(detail.caseRatesChangedSinceSent).toHaveLength(1);
    expect((await loadInvoiceDetail(testDb, onCase.invoiceId, 'staff'))!.caseRatesChangedSinceSent).toEqual([]);
  });

  it('reopens a case closed here, adding the sender back', async () => {
    const caseId = await newCase('26-CR-00211');
    await closeCase(testDb, reviewer, caseId, { reasonDetail: 'Tidying up.' });
    const person = await newProfessional(100);
    const { invoiceId } = await filedByPerson(person, '26-CR-00211');

    await expect(matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId, addMissing: false })).rejects.toBeInstanceOf(ValidationError);
    expect((await testDb.select({ closedOn: caseTable.closedOn }).from(caseTable).where(eq(caseTable.caseId, caseId)))[0]?.closedOn).not.toBeNull();

    await matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId, addMissing: true });

    expect((await testDb.select({ closedOn: caseTable.closedOn }).from(caseTable).where(eq(caseTable.caseId, caseId)))[0]?.closedOn).toBeNull();
    const events = await testDb.select({ reason: caseLifecycleEvent.reasonDetail }).from(caseLifecycleEvent).where(eq(caseLifecycleEvent.caseId, caseId));
    expect(events.at(-1)?.reason).toBe(REOPENED_BY_MATCH);
    const assigned = await testDb
      .select()
      .from(caseAssignment)
      .where(and(eq(caseAssignment.caseId, caseId), eq(caseAssignment.professionalId, person.professionalId), isNull(caseAssignment.endedAt)));
    expect(assigned).toHaveLength(1);
  });

  it('refuses an invoice that already has its case', async () => {
    const caseId = await newCase('26-CR-00211');
    const other = await newCase('26-CR-00212');
    const person = await newProfessional(100);
    const { invoiceId } = await filedByPerson(person, '26-CR-00211', caseId);

    await expect(matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId: other, addMissing: true })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('the case pages', () => {
  it('list each case with its number, who works on it, what is pre-authorized and what is waiting, and the latest changes', async () => {
    const caseId = await newCase('26-CR-00211');
    const person = await newProfessional(100);
    await setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: person.professionalId, amount: 500 });
    const { invoiceId } = await filedByPerson(person, '26-CR-00211');
    const submittedId = await getReferenceId(testDb, invoiceStatuses, 'submitted');
    await testDb.transaction((tx) =>
      recordInvoiceEvent(tx, { invoiceId, eventTypeCode: 'submitted', statusId: submittedId, actorUserAccountId: person.userAccountId }),
    );
    await matchInvoiceToCase(testDb, reviewer, invoiceId, { caseId, addMissing: true });

    const extras = (await loadCaseListExtras(testDb, [caseId])).get(caseId);
    expect(extras).toMatchObject({
      caseNumber: '26-CR-00211',
      workers: [expect.any(String)],
      preauthorized: '500.00',
      waiting: { count: 1, total: '200.00' },
    });
    const changes = await loadRecentCaseChanges(testDb);
    expect(changes[0]).toMatchObject({ caseId, what: 'An invoice matched to this case', by: 'Reviewer One', caseNumber: '26-CR-00211' });
    expect(changes.some((change) => change.caseId === caseId && change.what === 'Case opened')).toBe(true);
    expect(changes.some((change) => change.caseId === caseId && change.what === 'An invoice sent, no reviewer assigned yet')).toBe(true);
  });
});

describe('pre-authorized amounts', () => {
  it('lets any staff member enter one, then change it, keeping each decision', async () => {
    const caseId = await newCase('26-CR-00211');
    const person = await newProfessional(100);
    const outsider = await newProfessional(100);

    await expect(
      setPreauthorizedAmount(testDb, outsider.userAccountId, caseId, { professionalId: person.professionalId, amount: 500 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { preauthorizationId } = await setPreauthorizedAmount(testDb, reviewer, caseId, {
      professionalId: person.professionalId,
      amount: 500,
      authorizationNumber: 'PA-1',
    });
    await setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: person.professionalId, amount: 300 });

    expect(await loadPreauthorizationSummaries(testDb, caseId)).toMatchObject([
      { professionalId: person.professionalId, ceiling: '300.00', authorizationNumbers: ['PA-1'] },
    ]);
    expect(await testDb.select().from(preauthorizationDecision).where(eq(preauthorizationDecision.preauthorizationId, preauthorizationId))).toHaveLength(2);
    await expect(setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: person.professionalId, amount: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('flags an invoice that takes its person over the amount, without blocking review', async () => {
    const caseId = await newCase('26-CR-00211');
    const person = await newProfessional(100);
    await setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: person.professionalId, amount: 150 });
    const { invoiceId } = await filedByPerson(person, '26-CR-00211', caseId);

    const { invoices } = await listReviewQueue(testDb, 'open');
    expect(invoices.find((row) => row.invoiceId === invoiceId)?.flags).toContainEqual({
      kind: 'preauthorization',
      message: 'Over the pre-authorized $150.00, not explained',
    });
    await setPreauthorizedAmount(testDb, reviewer, caseId, { professionalId: person.professionalId, amount: 250 });
    const after = await listReviewQueue(testDb, 'open');
    expect(after.invoices.find((row) => row.invoiceId === invoiceId)?.flags.map((flag) => flag.kind)).not.toContain('preauthorization');
  });
});
