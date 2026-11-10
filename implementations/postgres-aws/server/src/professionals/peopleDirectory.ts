// Everyone who can send invoices, with who is paid, today's approved rates and
// what is waiting. Staff accounts' own profiles are left out, as in
// ../routes/professionals.ts.
import { and, count, eq, inArray, isNull, max, notInArray, or, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { DatabaseOrTransaction } from '../db/client';
import { invoice, invoiceStatuses, person, professional, professionalKinds, userAccount } from '../db/schema';
import { NotFoundError } from '../errors';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { listOwnTravelRates, listRates, rateOn } from '../billing/professionalRates';
import { mileageRateOn, mileageRatesForEach } from '../billing/mileageRates';
import { loadPersonReviewer } from '../billing/reviewAssignment';
import { IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';

async function selectPeople(db: DatabaseOrTransaction, professionalId?: string) {
  const staffAccountRoleIds = await getStaffAccountRoleIds(db);
  const people = await db
    .select({
      professionalId: professional.professionalId,
      displayName: professional.displayName,
      active: professional.active,
      // Someone added who hasn't signed in has it on their person record.
      email: sql<string | null>`coalesce(${userAccount.email}, ${person.email})`,
      signedIn: sql<boolean>`${professional.userAccountId} is not null`,
      phone: professional.phone,
      paidThrough: professional.paidThrough,
      professionalKindId: professional.professionalKindId,
      role: professionalKinds.displayName,
    })
    .from(professional)
    .innerJoin(person, eq(professional.personId, person.personId))
    .leftJoin(userAccount, eq(professional.userAccountId, userAccount.userAccountId))
    .leftJoin(professionalKinds, eq(professional.professionalKindId, professionalKinds.id))
    .where(
      and(
        // A vendor account has no system role; plain `not in` would drop NULLs.
        or(isNull(userAccount.systemRoleId), notInArray(userAccount.systemRoleId, staffAccountRoleIds)),
        ...(professionalId ? [eq(professional.professionalId, professionalId)] : []),
      ),
    )
    .orderBy(professional.displayName);

  const ids = people.map((row) => row.professionalId);
  const today = new Date().toISOString().slice(0, 10);
  const [rates, mileage, travel] = await Promise.all([listRates(db, ids), mileageRatesForEach(db, ids), listOwnTravelRates(db, ids)]);
  return people.map((row) => ({
    ...row,
    hourlyRate: rateOn(rates, row.professionalId, today) ?? null,
    ratePerMile: mileageRateOn(mileage.get(row.professionalId) ?? [], today) ?? null,
    // Their own only; without one, travel time follows the travel time setting.
    travelHourlyRate: rateOn(travel.get(row.professionalId) ?? [], row.professionalId, today) ?? null,
  }));
}

export async function listPeople(db: DatabaseOrTransaction) {
  const people = await selectPeople(db);
  const ids = people.map((row) => row.professionalId);
  const [waiting, latest] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ professionalId: invoice.professionalId, count: count(), total: sum(invoice.submittedTotal) })
            .from(invoice)
            .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
            .where(and(inArray(invoice.professionalId, ids), inArray(invoiceStatuses.code, IN_REVIEW_INVOICE_STATUS_CODES)))
            .groupBy(invoice.professionalId),
          db
            .select({ professionalId: invoice.professionalId, at: max(invoice.submittedAt) })
            .from(invoice)
            .where(inArray(invoice.professionalId, ids))
            .groupBy(invoice.professionalId),
        ]);
  return people.map((row) => {
    const waitingRow = waiting.find((entry) => entry.professionalId === row.professionalId);
    return {
      ...row,
      waiting: { count: waitingRow?.count ?? 0, total: waitingRow?.total ?? '0.00' },
      lastInvoiceAt: latest.find((entry) => entry.professionalId === row.professionalId)?.at ?? null,
    };
  });
}

// Their invoices come from the queue (../billing/reviewQueue.ts).
export async function getPerson(db: DatabaseOrTransaction, professionalId: string) {
  const [row] = z.uuid().safeParse(professionalId).success ? await selectPeople(db, professionalId) : [];
  if (!row) {
    throw new NotFoundError('No such person.');
  }
  return { ...row, reviewer: await loadPersonReviewer(db, professionalId) };
}
