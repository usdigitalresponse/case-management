import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { createStaff } from './reviewHelpers';
import { giveRate } from './rateHelpers';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { addOwnRates } from '../src/billing/professionalRates';
import { addTimeCategoryRate } from '../src/billing/timeCategoryRates';
import { addMileageRate } from '../src/billing/mileageRates';
import { priceLines } from '../src/billing/priceLines';
import { applyLineRate } from '../src/billing/caseRates';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { setMileageWarning } from '../src/billing/mileageWarnings';
import { editProfessional } from '../src/professionals/editProfessional';
import { getPerson } from '../src/professionals/peopleDirectory';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { getReferenceId } from '../src/db/referenceLookups';
import { ValidationError } from '../src/errors';
import {
  expenseTypes,
  invoice,
  invoiceApprovalChain,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  trip,
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

async function newProfessional(hourlyRate: number) {
  const email = `vendor-${randomUUID()}@example.com`;
  const [account] = await testDb.insert(userAccount).values({ displayName: email, email, active: true }).returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, email);
  await giveRate(testDb, admin, professionalId, hourlyRate);
  return { userAccountId: account!.userAccountId, professionalId };
}

// A sent invoice with one trip: travel time and mileage on its date.
async function sentTrip(caseId: string, person: { userAccountId: string; professionalId: string }, hours: string, miles: string) {
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
  const [journey] = await testDb
    .insert(trip)
    .values({ invoiceId, tripDate: '2026-02-02', tripOrigin: 'Office', tripDestination: 'Court', roundTrip: false })
    .returning();
  const lines = await testDb
    .insert(invoiceLine)
    .values([
      { invoiceId, caseId, lineTypeId: await getReferenceId(testDb, invoiceLineTypes, 'time'), amount: '0', serviceDate: '2026-02-02', quantity: hours, tripId: journey!.tripId, position: 0 },
      {
        invoiceId,
        caseId,
        lineTypeId: await getReferenceId(testDb, invoiceLineTypes, 'expense'),
        expenseTypeId: await getReferenceId(testDb, expenseTypes, 'mileage'),
        amount: '0',
        serviceDate: '2026-02-02',
        quantity: miles,
        tripId: journey!.tripId,
        position: 1,
      },
    ])
    .returning();
  await testDb.transaction((tx) => priceLines(tx, invoiceId, { billedProfessionalId: person.professionalId, unmatchedMeansBilled: true, strict: true }));
  const sorted = lines.sort((a, b) => a.position - b.position);
  return { invoiceId, travelLineId: sorted[0]!.invoiceLineId, mileageLineId: sorted[1]!.invoiceLineId };
}

describe('a person’s own travel time rate', () => {
  it('prices travel time before the travel time setting, and after a case rate', async () => {
    await addTimeCategoryRate(testDb, admin, { category: 'travel', basis: 'percent_of_hourly_rate', percent: 50, effectiveFrom: '2025-01-01' });
    await addMileageRate(testDb, admin, { ratePerMile: 0.5, effectiveFrom: '2025-01-01' });
    const caseId = await newCase();
    const person = await newProfessional(100);

    const { invoiceId: setting } = await sentTrip(caseId, person, '2', '10');
    expect((await loadInvoiceDetail(testDb, setting, 'staff'))!.lines[0]).toMatchObject({ configuredRate: '50.000', rateSource: 'kind' });

    await addOwnRates(testDb, admin, person.professionalId, { travelHourlyRate: 70, effectiveFrom: '2026-01-01' });
    const { invoiceId: own, travelLineId } = await sentTrip(caseId, person, '2', '10');
    expect((await loadInvoiceDetail(testDb, own, 'staff'))!.lines[0]).toMatchObject({ configuredRate: '70.000', rateSource: 'person', amount: '140.00' });

    await applyLineRate(testDb, reviewer, own, travelLineId, { rate: 80, scope: 'case', target: 'person', reasonCode: 'case_rate_agreed', basedOnCaseRateId: null });
    const { invoiceId: later } = await sentTrip(caseId, person, '2', '10');
    expect((await loadInvoiceDetail(testDb, later, 'staff'))!.lines[0]).toMatchObject({ configuredRate: '80.000', rateSource: 'case_person' });
  });

  it('is set and changed on the person, from today', async () => {
    const person = await newProfessional(100);
    await editProfessional(testDb, admin, person.professionalId, { displayName: 'Sample Person', travelHourlyRate: 60 });
    expect(await getPerson(testDb, person.professionalId)).toMatchObject({ travelHourlyRate: '60.00' });
  });
});

describe('a mileage warning caused by stops', () => {
  it('is set aside with a reason, shown to staff with who and when, and can be put back', async () => {
    await addMileageRate(testDb, admin, { ratePerMile: 0.5, effectiveFrom: '2025-01-01' });
    const caseId = await newCase();
    const person = await newProfessional(100);
    const { invoiceId, travelLineId, mileageLineId } = await sentTrip(caseId, person, '1', '30');

    await expect(setMileageWarning(testDb, reviewer, invoiceId, mileageLineId, { dismissed: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setMileageWarning(testDb, reviewer, invoiceId, travelLineId, { dismissed: true, reason: 'Stops' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await setMileageWarning(testDb, reviewer, invoiceId, mileageLineId, { dismissed: true, reason: 'Stopped at the jail on the way.' });

    const staff = (await loadInvoiceDetail(testDb, invoiceId, 'staff'))!;
    expect(staff.mileageDismissals).toMatchObject([
      { invoiceLineId: mileageLineId, reason: 'Stopped at the jail on the way.', dismissedByDisplayName: 'Reviewer One' },
    ]);
    expect((await loadInvoiceDetail(testDb, invoiceId, 'submitter'))!.mileageDismissals).toEqual([]);

    await setMileageWarning(testDb, reviewer, invoiceId, mileageLineId, { dismissed: false });
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.mileageDismissals).toEqual([]);
  });
});
