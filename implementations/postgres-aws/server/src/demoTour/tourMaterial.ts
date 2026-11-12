// Each guided tour run gets its own synthetic case and invoices, made with
// the same domain functions as the demo seed, so its steps are always doable
// on a shared demo and one visitor's tour can't use up another's.
import { randomInt, randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { caseAssignment, caseStatuses, county, demoTourRun, invoiceLine, routeCheck } from '../db/schema';
import { ROLE_IDS } from '../db/syntheticIds';
import { createCase } from '../intake/createCase';
import { createInvoice } from '../portal/createInvoice';
import { getExternalSubmitterRoleId } from '../professionals/externalSubmitterRole';
import { reassignReviewer, setSignOffApprovers } from '../billing/reviewAssignment';
import { reviewInvoiceLine } from '../billing/reviewInvoiceLine';
import { askQuestion } from '../billing/reviewQuestions';
import { finishReview } from '../billing/reviewRounds';
import { pairKey } from '../billing/routeCheck';
import { RATE_REASON_CODE } from '../billing/decisionReasons';
import type { TourAccounts, TourRole } from './tourAccounts';
import { recordTourRecords } from './tourRuns';

export const TOUR_MISSIONS = ['staff-filing', 'preauth-send', 'review', 'answer-finish', 'sign-off'] as const;
export type TourMission = (typeof TOUR_MISSIONS)[number];

export const FIRST_ROLE: Record<TourMission, TourRole> = {
  'staff-filing': 'staff',
  'preauth-send': 'vendor',
  review: 'staff',
  'answer-finish': 'vendor',
  'sign-off': 'director',
};

// Kept in the visitor's session; small, since the session is a cookie.
export interface TourRun {
  runId: string;
  mission: TourMission;
  accounts: { staff: string; director: string; vendor: string };
  caseId?: string;
  caseNumber?: string;
  clientName?: string;
  vendorName: string;
  invoiceId?: string;
  earlierInvoiceId?: string;
  otherCaseInvoiceId?: string;
  // The sample file's details, drawn again when it is downloaded.
  sample?: { invoiceNumber: string; periodStart: string; periodEnd: string };
}

// Values the guide offers to fill in or copy; nothing here is stored.
export type TourSuggestions = Record<string, string | number | Array<Record<string, string | number>>>;

const TOUR_OFFICE = '100 Example Street, Sample City';
const TOUR_SITE = '400 Justice Plaza, Sample City';
// One way; the tour's trip claims far more for the round trip.
const TOUR_SITE_MILES = '6.2';
export const TOUR_RATE = 95;

const iso = (date: Date) => date.toISOString().slice(0, 10);

// Last calendar month, so every date is in the past.
export function lastMonth(today = new Date()) {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const day = (n: number) => iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), n)));
  return { start: iso(start), end: iso(end), day };
}

const tourNumber = (prefix: string) => `${prefix}-${randomInt(10000, 99999)}`;

async function openStatusId(db: Database): Promise<string> {
  const rows = await db.select({ id: caseStatuses.id, code: caseStatuses.code }).from(caseStatuses);
  const open = rows.find((row) => /open/i.test(row.code)) ?? rows[0];
  if (!open) throw new Error('No case statuses; reset the demo data first.');
  return open.id;
}

async function tourCase(db: Database, accounts: TourAccounts, runId: string) {
  const clientName = faker.person.fullName();
  const caseNumber = tourNumber('26-TR');
  const [anyCounty] = await db.select({ countyId: county.countyId }).from(county).where(eq(county.active, true)).orderBy(asc(county.displayName)).limit(1);
  const { caseId } = await createCase(db, { userAccountId: accounts.staff }, {
    requestId: randomUUID(),
    newClient: { displayName: clientName, confirmedNew: true },
    caseNumber,
    participantRoleId: ROLE_IDS.CLIENT_PARTICIPANT,
    statusId: await openStatusId(db),
    effectiveAt: new Date(),
    countyId: anyCounty?.countyId,
  });
  await db.insert(caseAssignment).values({
    caseId,
    professionalId: accounts.vendorProfessionalId,
    assignedAt: new Date(),
    assignmentRoleId: await getExternalSubmitterRoleId(db),
    assignedByUserAccountId: accounts.staff,
  });
  await recordTourRecords(db, runId, [{ table: 'case', id: caseId }]);
  return { caseId, caseNumber, clientName };
}

async function lineIds(db: Database, invoiceId: string): Promise<string[]> {
  const rows = await db
    .select({ id: invoiceLine.invoiceLineId })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, invoiceId))
    .orderBy(asc(invoiceLine.serviceDate), asc(invoiceLine.position));
  return rows.map((row) => row.id);
}

// The trip's driving distance, cached as a lookup would leave it, so the
// mileage check runs without a billed route lookup.
async function cacheTourRoute(db: Database): Promise<void> {
  const key = pairKey(TOUR_OFFICE, TOUR_SITE)!;
  const [cached] = await db.select({ key: routeCheck.pairKey }).from(routeCheck).where(and(eq(routeCheck.pairKey, key), inArray(routeCheck.outcome, ['found']))).limit(1);
  if (!cached) {
    await db.insert(routeCheck).values({ pairKey: key, outcome: 'found', distanceMiles: TOUR_SITE_MILES, apiCalls: 0, checkedAt: new Date() });
  }
}

const vendorActor = (accounts: TourAccounts) => ({ userAccountId: accounts.vendor, professionalId: accounts.vendorProfessionalId });

const time = (serviceDate: string, quantity: number, description: string) => ({ lineType: 'time' as const, serviceDate, quantity, description });

// A sent invoice on the tour case, taken by the staff demo sign-in to review.
async function sentForReview(db: Database, accounts: TourAccounts, caseId: string, invoiceNumber: string) {
  const month = lastMonth();
  const sent = await createInvoice(db, vendorActor(accounts), {
    caseId,
    attested: true,
    invoiceNumber,
    periodStart: month.start,
    periodEnd: month.end,
    lines: [
      time(month.day(6), 2, 'Interviewed the first witness'),
      time(month.day(13), 1.5, 'Wrote up the interview notes'),
      time(month.day(20), 3, 'Photographed and measured the scene'),
    ],
  });
  await reassignReviewer(db, accounts.staff, sent.invoiceId, { userAccountId: accounts.staff });
  return sent.invoiceId;
}

export async function createTourMaterial(
  db: Database,
  mission: TourMission,
  accounts: TourAccounts,
): Promise<{ run: TourRun; suggestions: TourSuggestions }> {
  const run: TourRun = {
    runId: randomUUID(),
    mission,
    accounts: { staff: accounts.staff, director: accounts.director, vendor: accounts.vendor },
    vendorName: accounts.vendorName,
  };
  const month = lastMonth();
  await db.insert(demoTourRun).values({ demoTourRunId: run.runId, mission });

  if (mission === 'staff-filing') {
    // Nothing is made: the visitor enters a paper invoice by hand.
    const lines = [
      { date: month.day(4), description: 'Interviewed the client at the jail', hours: 2 },
      { date: month.day(11), description: 'Located and interviewed a witness', hours: 3.5 },
      { date: month.day(18), description: 'Requested and reviewed phone records', hours: 1.5 },
    ];
    const total = lines.reduce((sum, line) => sum + line.hours * TOUR_RATE, 0);
    return {
      run,
      suggestions: {
        billedBy: accounts.vendorName,
        receivedVia: 'Mail',
        receivedOn: iso(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)),
        invoiceNumber: tourNumber('PAPER'),
        caseNumber: tourNumber('26-TR'),
        periodStart: month.start,
        periodEnd: month.end,
        rate: TOUR_RATE,
        lines: lines.map((line) => ({ ...line, amount: line.hours * TOUR_RATE })),
        // The paper's own total is added up wrong; the app adds the lines itself.
        statedTotal: total + TOUR_RATE,
      },
    };
  }

  const tour = await tourCase(db, accounts, run.runId);
  Object.assign(run, tour);

  if (mission === 'preauth-send') {
    run.sample = { invoiceNumber: tourNumber('INV'), periodStart: month.start, periodEnd: month.end };
    return {
      run,
      suggestions: {
        service: 'Witness interviews and scene photographs',
        rate: TOUR_RATE,
        // Over the demo's county threshold, so it is needed.
        hours: 30,
        requestedAmount: 30 * TOUR_RATE,
        justification: 'Three witnesses named in the police report have not been interviewed, and the scene needs photographing.',
        approvedAmount: 1500,
        decisionReason: 'Approved for the interviews and photographs. Ask again if more is needed.',
        overrunExplanation: 'A fourth witness came forward during the interviews and had to be seen before the hearing.',
      },
    };
  }

  if (mission === 'review') {
    await cacheTourRoute(db);
    const other = await tourCase(db, accounts, run.runId);
    const busyDay = month.day(20);
    // Earlier, for overlapping weeks on the same case: the double-billing check.
    const earlier = await createInvoice(db, vendorActor(accounts), {
      caseId: tour.caseId,
      attested: true,
      invoiceNumber: tourNumber('INV'),
      periodStart: month.start,
      periodEnd: month.day(15),
      lines: [time(month.day(5), 2, 'Interviewed the first witness'), time(month.day(12), 1.5, 'Wrote up the interview notes')],
    });
    // The same day on another case: with this invoice, more hours than one day holds.
    const otherCase = await createInvoice(db, vendorActor(accounts), {
      caseId: other.caseId,
      attested: true,
      invoiceNumber: tourNumber('INV'),
      periodStart: month.start,
      periodEnd: month.end,
      lines: [
        time(busyDay, 6, 'Canvassed the neighborhood for witnesses'),
        { lineType: 'mileage', serviceDate: busyDay, description: 'Drove to the neighborhood and back', quantity: 14, tripOrigin: TOUR_OFFICE, tripDestination: TOUR_SITE, roundTrip: true },
      ],
    });
    const trip = { serviceDate: busyDay, tripOrigin: TOUR_OFFICE, tripDestination: TOUR_SITE, roundTrip: true, tripKey: 'site' };
    const main = await createInvoice(db, vendorActor(accounts), {
      caseId: null,
      // As a sender might type it: no dashes.
      caseNumber: tour.caseNumber.replace(/-/g, ''),
      attested: true,
      invoiceNumber: tourNumber('INV'),
      periodStart: month.day(10),
      periodEnd: month.end,
      lines: [
        time(month.day(14), 1.5, 'Reviewed the police report and witness list'),
        time(busyDay, 5.5, 'Located and interviewed two witnesses at the site'),
        // One trip: its travel time, miles and parking are separate lines.
        { ...trip, lineType: 'time', quantity: 1, description: 'Travel to the site and back' },
        { ...trip, lineType: 'mileage', quantity: 30, description: 'Drove to the site and back' },
        { ...trip, lineType: 'expense', amount: 12, description: 'Parking at the site' },
        time(month.day(26), 2, 'Wrote the investigation summary'),
      ],
    });
    for (const invoiceId of [earlier.invoiceId, main.invoiceId]) {
      // eslint-disable-next-line no-await-in-loop
      await reassignReviewer(db, accounts.staff, invoiceId, { userAccountId: accounts.staff });
    }
    // Typed without a case, so not under the run's case until matched.
    await recordTourRecords(db, run.runId, [{ table: 'invoice', id: main.invoiceId }]);
    run.invoiceId = main.invoiceId;
    run.earlierInvoiceId = earlier.invoiceId;
    run.otherCaseInvoiceId = otherCase.invoiceId;
    return {
      run,
      suggestions: {
        caseNumber: tour.caseNumber,
        typedCaseNumber: tour.caseNumber.replace(/-/g, ''),
        reducedRate: TOUR_RATE - 10,
        question: 'Were both witnesses interviewed on this visit, or was one by phone?',
      },
    };
  }

  const invoiceId = await sentForReview(db, accounts, tour.caseId, tourNumber('INV'));
  run.invoiceId = invoiceId;
  // The tour's Director signs off, whoever else may.
  await setSignOffApprovers(db, accounts.staff, invoiceId, { userAccountIds: [accounts.director] });
  const [first, second, third] = await lineIds(db, invoiceId);
  if (!first || !second || !third) throw new Error('Expected three lines on the tour invoice.');

  if (mission === 'answer-finish') {
    await reviewInvoiceLine(db, accounts.staff, invoiceId, first, { outcome: 'approved' });
    await reviewInvoiceLine(db, accounts.staff, invoiceId, second, { outcome: 'approved' });
    await askQuestion(db, accounts.staff, invoiceId, { invoiceLineId: third, question: 'Was the scene visit done in one trip, or two?' });
    return { run, suggestions: { answer: 'One trip; the measurements and photographs were taken the same afternoon.' } };
  }

  // sign-off: reviewed and finished, one rate lowered, waiting for the Director.
  await reviewInvoiceLine(db, accounts.staff, invoiceId, first, { outcome: 'approved' });
  await reviewInvoiceLine(db, accounts.staff, invoiceId, second, {
    outcome: 'approved',
    approvedRate: TOUR_RATE - 15,
    reasonCode: RATE_REASON_CODE,
    note: 'Write-ups are paid at the lower rate.',
  });
  await reviewInvoiceLine(db, accounts.staff, invoiceId, third, { outcome: 'approved' });
  await finishReview(db, accounts.staff, invoiceId);
  return {
    run,
    suggestions: {
      approveComment: 'Approved with the write-up rate lowered, as agreed.',
      sendBackComment: 'Please check the lowered write-up rate with the provider before I approve.',
    },
  };
}
