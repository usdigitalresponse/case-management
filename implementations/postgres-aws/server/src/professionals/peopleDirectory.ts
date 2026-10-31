// Everyone who can send invoices (design G21, G23): attorneys, investigators
// and experts, with who is paid for their work, their approved rates today
// and what is waiting for review. Staff accounts' own professional profiles
// (../cases/assignStaffToCase.ts) are left out, as in ../routes/professionals.ts.
import { and, count, eq, inArray, isNull, max, notInArray, or, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { DatabaseOrTransaction } from '../db/client';
import { invoice, invoiceStatuses, person, professional, professionalKinds, userAccount } from '../db/schema';
import { NotFoundError } from '../errors';
import { getStaffAccountRoleIds } from '../auth/staffAccountRole';
import { listRates, rateOn } from '../billing/professionalRates';
import { mileageRateOn, mileageRatesFor } from '../billing/mileageRates';
import { loadPersonReviewer } from '../billing/reviewAssignment';
import { IN_REVIEW_INVOICE_STATUS_CODES } from '../billing/invoiceStatusCodes';

async function selectPeople(db: DatabaseOrTransaction, professionalId?: string) {
  const staffAccountRoleIds = await getStaffAccountRoleIds(db);
  return db
    .select({
      professionalId: professional.professionalId,
      displayName: professional.displayName,
      active: professional.active,
      // Someone added who hasn't signed in has their email on their person record.
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
}

export async function listPeople(db: DatabaseOrTransaction) {
  const people = await selectPeople(db);
  const ids = people.map((row) => row.professionalId);
  const today = new Date().toISOString().slice(0, 10);
  const [rates, mileage, waiting, latest] = await Promise.all([
    listRates(db, ids),
    Promise.all(ids.map((id) => mileageRatesFor(db, id))),
    ids.length === 0
      ? []
      : db
          .select({ professionalId: invoice.professionalId, count: count(), total: sum(invoice.submittedTotal) })
          .from(invoice)
          .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
          .where(and(inArray(invoice.professionalId, ids), inArray(invoiceStatuses.code, IN_REVIEW_INVOICE_STATUS_CODES)))
          .groupBy(invoice.professionalId),
    ids.length === 0
      ? []
      : db
          .select({ professionalId: invoice.professionalId, at: max(invoice.submittedAt) })
          .from(invoice)
          .where(inArray(invoice.professionalId, ids))
          .groupBy(invoice.professionalId),
  ]);
  return people.map((row, index) => {
    const waitingRow = waiting.find((entry) => entry.professionalId === row.professionalId);
    return {
      ...row,
      hourlyRate: rateOn(rates, row.professionalId, today) ?? null,
      ratePerMile: mileageRateOn(mileage[index] ?? [], today) ?? null,
      waiting: { count: waitingRow?.count ?? 0, total: waitingRow?.total ?? '0.00' },
      lastInvoiceAt: latest.find((entry) => entry.professionalId === row.professionalId)?.at ?? null,
    };
  });
}

// One person's details for their page; their invoices come from the queue.
export async function getPerson(db: DatabaseOrTransaction, professionalId: string) {
  if (!z.uuid().safeParse(professionalId).success) {
    throw new NotFoundError('No such person.');
  }
  const [row] = await selectPeople(db, professionalId);
  if (!row) {
    throw new NotFoundError('No such person.');
  }
  const today = new Date().toISOString().slice(0, 10);
  const [rates, mileage, reviewer] = await Promise.all([
    listRates(db, [professionalId]),
    mileageRatesFor(db, professionalId),
    loadPersonReviewer(db, professionalId),
  ]);
  return {
    ...row,
    hourlyRate: rateOn(rates, professionalId, today) ?? null,
    ratePerMile: mileageRateOn(mileage, today) ?? null,
    reviewer,
  };
}
