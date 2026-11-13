import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, testPool } from './testDb';
import { resetAndSeedBaselineFixtures, type BaselineFixtureIds } from '../src/db/fixtures';
import { createCase } from '../src/intake/createCase';
import { ensureProfessionalForUserAccount } from '../src/professionals/ensureProfessional';
import { resolvePortalActor, type PortalActor } from '../src/portal/portalActor';
import { createInvoice } from '../src/portal/createInvoice';
import { updateDraftInvoice } from '../src/billing/invoiceLifecycle/drafts';
import { loadInvoiceDetail } from '../src/billing/invoiceDetail';
import { listReviewQueue } from '../src/billing/reviewQueue';
import { addMileageRate } from '../src/billing/mileageRates';
import { addKindRate, createKind, setProfessionalKind } from '../src/billing/professionalRates';
import { addTimeCategoryRate, categoryRateOn } from '../src/billing/timeCategoryRates';
import { setBillingRule } from '../src/billing/billingRules';
import { activityTypes, caseAssignment, invoiceApprovalChain, timeEntry, trip, userAccount } from '../src/db/schema';

let fixtures: BaselineFixtureIds;

beforeEach(async () => {
  fixtures = await resetAndSeedBaselineFixtures(testDb);
});

afterAll(async () => {
  await testPool.end();
});

// An investigator billed at 100 an hour and 0.5 a mile.
async function setup(): Promise<{ actor: PortalActor; caseId: string }> {
  const [account] = await testDb
    .insert(userAccount)
    .values({ displayName: 'Synthetic Investigator', email: `${randomUUID()}@example.com`, active: true })
    .returning();
  const professionalId = await ensureProfessionalForUserAccount(testDb, account!.userAccountId, 'Synthetic Investigator');
  const { professionalKindId } = await createKind(testDb, { displayName: 'Investigator' });
  await addKindRate(testDb, fixtures.staffUserAccountId, professionalKindId, { hourlyRate: 100, effectiveFrom: '2026-01-01' });
  await setProfessionalKind(testDb, professionalId, { professionalKindId });
  await addMileageRate(testDb, fixtures.staffUserAccountId, { ratePerMile: 0.5, effectiveFrom: '2026-01-01' });
  const { caseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
    requestId: randomUUID(),
    personId: fixtures.clientPersonId,
    participantRoleId: fixtures.clientParticipantRoleId,
    statusId: fixtures.caseStatusOpenId,
    effectiveAt: new Date('2026-01-01T12:00:00Z'),
  });
  await testDb.insert(caseAssignment).values({
    caseId,
    professionalId,
    assignedAt: new Date('2026-01-01T12:00:00Z'),
    assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
    assignedByUserAccountId: fixtures.staffUserAccountId,
  });
  return { actor: await resolvePortalActor(testDb, account!.userAccountId), caseId };
}

const route = { tripOrigin: '100 Main Street, Springfield', tripDestination: '1 Court Plaza, Springfield', roundTrip: true };

// Travel time, mileage and parking on one trip; only the first line is dated.
const tripLines = (key = 'court') => [
  { lineType: 'time' as const, serviceDate: '2026-02-02', quantity: 2, description: 'Travel to court', tripKey: key, ...route },
  { lineType: 'mileage' as const, quantity: 30, description: 'Drive to court', tripKey: key, ...route },
  { lineType: 'expense' as const, amount: 10, description: 'Parking', tripKey: key, ...route },
];

const travelRate = (input: Record<string, unknown>) =>
  addTimeCategoryRate(testDb, fixtures.staffUserAccountId, { category: 'travel', effectiveFrom: '2026-01-01', ...input });

describe('trips', () => {
  it('save travel time, mileage and costs as separate lines on one trip, sharing its date and route', async () => {
    const { actor, caseId } = await setup();
    await travelRate({ basis: 'percent_of_hourly_rate', percent: 50 });
    const { invoiceId, submittedTotal } = await createInvoice(testDb, actor, { attested: true, caseId, submit: false, lines: tripLines() });
    expect(submittedTotal).toBe('125.00');
    const { lines } = (await loadInvoiceDetail(testDb, invoiceId))!;
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map((line) => line.tripId)).size).toBe(1);
    expect(lines.every((line) => line.serviceDate === '2026-02-02' && line.tripDestination === route.tripDestination && line.roundTrip)).toBe(true);
    expect(lines.find((line) => line.lineTypeCode === 'time')).toMatchObject({ amount: '100.00', billedRate: '50.000', configuredRate: '50.000' });
    // Its default, for review to flag a corrected rate against.
    expect(lines.find((line) => line.expenseTypeCode === 'mileage')).toMatchObject({ amount: '15.00', configuredRate: '0.500' });
  });

  it('price travel time like other time with no travel time rate, or at a flat rate', async () => {
    const { actor, caseId } = await setup();
    const unset = await createInvoice(testDb, actor, { attested: true, caseId, submit: false, lines: tripLines() });
    expect(unset.submittedTotal).toBe('225.00');
    await travelRate({ basis: 'flat_rate', hourlyRate: 40, effectiveFrom: '2026-02-01' });
    const flat = await createInvoice(testDb, actor, { attested: true, caseId, submit: false, lines: tripLines() });
    expect(flat.submittedTotal).toBe('105.00');
  });

  it('take at most one travel time and one mileage item, and only travel items', async () => {
    const { actor, caseId } = await setup();
    const [time, mileage] = tripLines();
    for (const lines of [[time, time], [mileage, mileage], [time, { lineType: 'other', amount: 5, tripKey: 'court' }]]) {
      await expect(createInvoice(testDb, actor, { attested: true, caseId, submit: false, lines })).rejects.toMatchObject({
        fieldErrors: expect.anything(),
      });
    }
  });

  it('give a mileage item entered alone a trip of its own, and replace trips with their lines', async () => {
    const { actor, caseId } = await setup();
    const { invoiceId } = await createInvoice(testDb, actor, { attested: true, caseId, submit: false, lines: tripLines() });
    const alone = { lineType: 'mileage' as const, serviceDate: '2026-02-03', quantity: 4, ...route };
    await updateDraftInvoice(testDb, actor, invoiceId, { lines: [alone, alone] });
    const trips = await testDb.select().from(trip).where(eq(trip.invoiceId, invoiceId));
    expect(trips).toHaveLength(2);
    expect(trips.every((row) => row.tripDate === '2026-02-03')).toBe(true);
  });

  it('record travel time as travel and freeze the trip in the submission snapshot', async () => {
    const { actor, caseId } = await setup();
    const { invoiceId } = await createInvoice(testDb, actor, { attested: true, caseId, lines: tripLines() });
    const { lines } = (await loadInvoiceDetail(testDb, invoiceId))!;
    const travel = lines.find((line) => line.lineTypeCode === 'time')!;
    const [entry] = await testDb
      .select({ activityCode: activityTypes.code })
      .from(timeEntry)
      .innerJoin(activityTypes, eq(timeEntry.activityTypeId, activityTypes.id))
      .where(eq(timeEntry.timeEntryId, travel.sourceTimeEntryId!));
    expect(entry?.activityCode).toBe('travel');
    const [chain] = await testDb.select().from(invoiceApprovalChain).where(eq(invoiceApprovalChain.invoiceId, invoiceId));
    const snapshot = chain!.submissionSnapshot as { spec_version: string; records: { trip: Array<{ tripId: string }> } };
    expect(snapshot.spec_version).toBe('0.15.0');
    expect(snapshot.records.trip).toEqual([expect.objectContaining({ tripId: travel.tripId, tripDate: '2026-02-02' })]);
  });

  it("flag travel hours well beyond the trip's distance at the average speed", async () => {
    const { actor, caseId } = await setup();
    await setBillingRule(testDb, fixtures.staffUserAccountId, 'travel_time_distance', {
      enforcement: 'warn',
      parameters: { averageSpeedMph: 30, tolerancePercent: 25 },
    });
    // 30 miles at 30 mph is an hour; 2 hours is over.
    const { invoiceId } = await createInvoice(testDb, actor, { attested: true, caseId, lines: tripLines() });
    expect((await loadInvoiceDetail(testDb, invoiceId))!.ruleFindings).toEqual([
      expect.objectContaining({ rule: 'travel_time_distance', message: expect.stringMatching(/claims 2 hours of travel for 30 miles, about 1 hour at 30 mph/) }),
    ]);
    const [time, miles] = tripLines('near');
    const within = await createInvoice(testDb, actor, { attested: true, caseId, lines: [{ ...time!, quantity: 1 }, miles!] });
    expect((await loadInvoiceDetail(testDb, within.invoiceId))!.ruleFindings).toEqual([]);
  });

  it("show reviewers the same person's travel on other cases that day", async () => {
    const { actor, caseId } = await setup();
    const { caseId: otherCaseId } = await createCase(testDb, { userAccountId: fixtures.staffUserAccountId }, {
      requestId: randomUUID(),
      personId: fixtures.clientPersonId,
      participantRoleId: fixtures.clientParticipantRoleId,
      statusId: fixtures.caseStatusOpenId,
      effectiveAt: new Date('2026-01-01T12:00:00Z'),
    });
    await testDb.insert(caseAssignment).values({
      caseId: otherCaseId,
      professionalId: actor.professionalId!,
      assignedAt: new Date('2026-01-01T12:00:00Z'),
      assignmentRoleId: fixtures.externalSubmitterAssignmentRoleId,
      assignedByUserAccountId: fixtures.staffUserAccountId,
    });
    const { invoiceId } = await createInvoice(testDb, actor, { attested: true, caseId, lines: tripLines() });
    await createInvoice(testDb, actor, { attested: true, caseId: otherCaseId, lines: tripLines() });
    // Same case, or not yet sent: not counted.
    await createInvoice(testDb, actor, { attested: true, caseId, lines: tripLines() });
    await createInvoice(testDb, actor, { attested: true, caseId: otherCaseId, submit: false, lines: tripLines() });
    expect((await loadInvoiceDetail(testDb, invoiceId, 'staff'))!.sameDayTravel).toEqual([{ date: '2026-02-02', otherInvoiceCount: 1 }]);
    expect((await listReviewQueue(testDb, 'all', { professionalId: actor.professionalId!, day: '2026-02-02' })).invoices).toHaveLength(3);
    expect((await listReviewQueue(testDb, 'all', { professionalId: actor.professionalId!, day: '2026-02-03' })).invoices).toHaveLength(0);
  });
});

describe('waiting time', () => {
  it('is priced at its own category rate and recorded as waiting', async () => {
    const { actor, caseId } = await setup();
    await addTimeCategoryRate(testDb, fixtures.staffUserAccountId, { category: 'waiting', basis: 'flat_rate', hourlyRate: 60, effectiveFrom: '2026-01-01' });
    const waiting = { lineType: 'time' as const, timeCategory: 'waiting' as const, serviceDate: '2026-02-02', quantity: 1.5, description: 'Waiting for the hearing' };
    const { invoiceId, submittedTotal } = await createInvoice(testDb, actor, { attested: true, caseId, lines: [waiting] });
    expect(submittedTotal).toBe('90.00');
    const [line] = (await loadInvoiceDetail(testDb, invoiceId))!.lines;
    expect(line).toMatchObject({ timeCategory: 'waiting', configuredRate: '60.000' });
    const [entry] = await testDb
      .select({ activityCode: activityTypes.code })
      .from(timeEntry)
      .innerJoin(activityTypes, eq(timeEntry.activityTypeId, activityTypes.id))
      .where(eq(timeEntry.timeEntryId, line!.sourceTimeEntryId!));
    expect(entry?.activityCode).toBe('waiting');
  });
});

describe('categoryRateOn', () => {
  const setting = (category: 'travel' | 'waiting', basis: string, extra: Record<string, string | null>, effectiveFrom = '2026-01-01') => ({
    category,
    basis: basis as 'hourly_rate',
    percent: null,
    hourlyRate: null,
    effectiveFrom,
    ...extra,
  });

  it("applies the category's latest setting on or before the date, rounding a percent to cents", () => {
    const settings = [
      setting('travel', 'percent_of_hourly_rate', { percent: '33.33' }),
      setting('travel', 'flat_rate', { hourlyRate: '45.00' }, '2026-06-01'),
      setting('waiting', 'flat_rate', { hourlyRate: '20.00' }),
    ];
    expect(categoryRateOn([], 'travel', '2026-02-01', '120.00')).toBe('120.00');
    expect(categoryRateOn(settings, 'travel', '2025-12-31', '120.00')).toBe('120.00');
    expect(categoryRateOn(settings, 'travel', '2026-02-01', '133.33')).toBe('44.44');
    expect(categoryRateOn(settings, 'travel', '2026-02-01', undefined)).toBeUndefined();
    expect(categoryRateOn(settings, 'travel', '2026-06-01', undefined)).toBe('45.00');
    expect(categoryRateOn(settings, 'waiting', '2026-02-01', '120.00')).toBe('20.00');
  });
});
