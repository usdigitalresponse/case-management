// Billing filed by person (design G): a person's own rates, their default
// reviewer, People, and a reviewer correcting a case number.
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { auditEvent, invoice, userAccount } from '../src/db/schema';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { addProfessional } from '../src/professionals/addProfessional';
import { editProfessional } from '../src/professionals/editProfessional';
import { getPerson, listPeople } from '../src/professionals/peopleDirectory';
import { createInvoice } from '../src/portal/createInvoice';
import { resolvePortalActor } from '../src/portal/portalActor';
import { addKindRate, addOwnRates, createKind, listRates, rateOn } from '../src/billing/professionalRates';
import { addMileageRate, mileageRateOn, mileageRatesFor } from '../src/billing/mileageRates';
import { loadAssignments, reassignReviewer } from '../src/billing/reviewAssignment';
import { correctCaseNumber } from '../src/billing/correctCaseNumber';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { fallbackTimekeeper } from '../src/billing/timekeeperFallback';
import { ValidationError } from '../src/errors';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

async function createSender(email: string, hourlyRate = 100) {
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, fixtures.staffUserAccountId, professionalId, hourlyRate);
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), professionalId };
}

async function send(actor: Awaited<ReturnType<typeof createSender>>['actor'], caseNumber: string, quantity = 2) {
  const { invoiceId } = await createInvoice(testDb, actor, {
    caseId: null,
    caseNumber,
    attested: true,
    lines: [{ lineType: 'time', serviceDate: '2026-03-02', quantity, description: 'Review' }],
  });
  return invoiceId;
}

describe('a person’s own rates', () => {
  it('replace their role’s hourly and the general mileage rate from when they take effect', async () => {
    const { professionalId } = await createSender('rates@example.com', 100);
    await addMileageRate(testDb, fixtures.staffUserAccountId, { ratePerMile: 0.6, effectiveFrom: '2025-01-01' });
    await addOwnRates(testDb, fixtures.staffUserAccountId, professionalId, { hourlyRate: 150, ratePerMile: 0.7, effectiveFrom: '2026-02-01' });

    const rates = await listRates(testDb, [professionalId]);
    expect(rateOn(rates, professionalId, '2026-01-15')).toBe('100.00');
    expect(rateOn(rates, professionalId, '2026-02-15')).toBe('150.00');
    const mileage = await mileageRatesFor(testDb, professionalId);
    expect(mileageRateOn(mileage, '2026-01-15')).toBe('0.600');
    expect(mileageRateOn(mileage, '2026-02-15')).toBe('0.700');
  });

  it('are set on adding someone, priced on their invoices and changed from today', async () => {
    const staff = await createStaff('admin');
    const { professionalKindId } = await createKind(testDb, { displayName: 'Sample role' });
    await addKindRate(testDb, staff, professionalKindId, { hourlyRate: 80, effectiveFrom: '2025-01-01' });
    const { professionalId } = await addProfessional(testDb, staff, {
      displayName: 'Sample Investigator',
      email: 'sample.investigator@example.com',
      professionalKindId,
      phone: '(555) 555-0123',
      paidThrough: 'Sample Investigations LLC',
      hourlyRate: 95,
      ratePerMile: 0.7,
    });
    expect(await getPerson(testDb, professionalId)).toMatchObject({
      paidThrough: 'Sample Investigations LLC',
      phone: '(555) 555-0123',
      hourlyRate: '95.00',
      ratePerMile: '0.700',
    });

    await editProfessional(testDb, staff, professionalId, {
      displayName: 'Sample Investigator',
      email: 'sample.investigator@example.com',
      hourlyRate: 110,
    });
    const rates = await listRates(testDb, [professionalId]);
    expect(rateOn(rates, professionalId, '2026-01-15')).toBe('95.00');
    expect(rateOn(rates, professionalId, new Date().toISOString().slice(0, 10))).toBe('110.00');
    const [changed] = await testDb.select().from(auditEvent).where(eq(auditEvent.eventType, 'professional_changed'));
    expect(changed?.priorValues).toMatchObject({ hourlyRate: '95.00' });
  });
});

describe('People', () => {
  it('lists senders with their rate and what is waiting, not staff', async () => {
    const { actor, professionalId } = await createSender('people@example.com', 120);
    await send(actor, '26-CR-00101');
    const people = await listPeople(testDb);
    expect(people.map((person) => person.professionalId)).toEqual([professionalId]);
    expect(people[0]).toMatchObject({ hourlyRate: '120.00', waiting: { count: 1, total: '240.00' } });
  });
});

describe('default reviewer per person', () => {
  it('sends a person’s new invoices to the reviewer chosen for them', async () => {
    const reviewer = await createStaff('reviewer');
    const { actor } = await createSender('routed@example.com');
    const first = await send(actor, '26-CR-00102');
    await reassignReviewer(testDb, reviewer, first, { userAccountId: reviewer, forPerson: true });

    const second = await send(actor, '26-CR-00103');
    expect((await loadAssignments(testDb, second)).reviewer?.userAccountId).toBe(reviewer);
  });
});

describe('who did the work, filed by person', () => {
  it('falls back to the invoice’s most common match, else the sender', () => {
    expect(fallbackTimekeeper(['a', 'b', 'a', null], 'sender')).toBe('a');
    expect(fallbackTimekeeper([null, undefined], 'sender')).toBe('sender');
  });

  it('needs the sender to send, so nothing waits on intake', async () => {
    // Someone staff could bill for, left unchosen.
    await createSender('unchosen@example.com');
    const staff = await resolvePortalActor(testDb, fixtures.staffUserAccountId);
    await expect(
      createInvoice(testDb, staff, {
        caseId: null,
        professionalId: null,
        caseNumber: '26-CR-00106',
        receivedVia: 'email',
        receivedOn: '2026-03-03',
        lines: [{ lineType: 'expense', amount: 20, serviceDate: '2026-03-02' }],
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('correcting a case number', () => {
  it('keeps what the sender typed, matches by the correction and audits it', async () => {
    const reviewer = await createStaff('reviewer');
    const { actor } = await createSender('typed@example.com');
    const typo = await send(actor, '26-CR-0104');
    const other = await send(actor, '26-CR-00105');

    expect(await correctCaseNumber(testDb, reviewer, typo, { caseNumber: '26-CR-00105' })).toMatchObject({
      caseNumberAsTyped: '26-CR-0104',
      caseNumberCorrected: '26-CR-00105',
    });
    const { invoices } = await listReviewQueue(testDb, 'open');
    expect(invoices.find((row) => row.invoiceId === other)?.caseNumberMatches).toEqual({ same: 1, close: 0 });
    const [audit] = await testDb.select().from(auditEvent).where(eq(auditEvent.eventType, 'case_number_corrected'));
    expect(audit).toMatchObject({ entityId: typo, priorValues: { caseNumberCorrected: null } });

    // Typing the sender's number back clears the correction.
    await correctCaseNumber(testDb, reviewer, typo, { caseNumber: '26-CR-0104' });
    const [row] = await testDb.select({ corrected: invoice.caseNumberCorrected }).from(invoice).where(eq(invoice.invoiceId, typo));
    expect(row?.corrected).toBeNull();
  });
});
